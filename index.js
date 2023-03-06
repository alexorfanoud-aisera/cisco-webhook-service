// See https://github.com/dialogflow/dialogflow-fulfillment-nodejs
// for Dialogflow fulfillment library docs, samples, and to report issues
'use strict';

const functions = require('firebase-functions')
const {WebhookClient} = require('dialogflow-fulfillment');
const axios = require('axios')
const { performance } = require('perf_hooks');
const requestCredentials = require('./server_creds.js') 

const constants = {
   intents:{
      DEFAULT_WELCOME: "Default Welcome Intent",
      HANDLED: "Handled Intent",
      ESCALATED: "Escalation Intent",
      FALLBACK: "Default Fallback Intent",
   },
   events: {
      TalkToAgent: "TalkToAgent",
   },
   contexts: {
      UnknownUtterance: {
         name: "unknownutterance",
         lifespan: 50,
         params: {
            retries: 1
         }
      }
   },
}

process.env.DEBUG = 'dialogflow:debug'; // enables lib debugging statements

exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
   const agent = new WebhookClient({ request, response });
   const user = agent?.originalRequest?.payload?.user || requestCredentials.users.alexorf
   const chatbot = JSON.parse(agent?.originalRequest?.payload?.chatbot) || requestCredentials.chatbots.dev0

   /**
      * Triggers on default welcome intent matching of the google dialogflow agent
      *
      * @param agent      Dialogflow webhook client constructed based on an incoming request
      *
      * @return {null} No return. Manipulates the agent to handle the response accordingly
      */   
      async function welcome(agent) {
         // set consecutive unknown utterances allowed before forwarding to live agent
         _resetUnknownUtteranceRetries(agent)
         await _resetAiseraConvContext(chatbot, user)
         agent.add("Welcome, how can i help?")
      }

   /**
      * Triggers on default fallback intent matching of the google dialogflow agent
      * Used to retrieve query response from aisera and return it to dialogflow
      *
      * @param agent      Dialogflow webhook client constructed based on an incoming request
      *
      * @return {null} No return. Manipulates the agent to handle the response accordingly
      */   
      async function fallback(agent) {
         var startTime = performance.now()
         let aisera_response = await _askAisera(agent.query, chatbot, user)

         if (_aiseraMatchedIntent(aisera_response)){
            // Aisera matched the intent successfully
            _resetUnknownUtteranceRetries(agent)
            agent.add(aisera_response)
         } else {
            // Aisera did not  match the utterance to an intent
            // ask user to repeat for some amount of times before forwarding to live agent
            let retriesLeft = _getContext(agent, constants.contexts.UnknownUtterance.name).parameters.retriesLeft
            if (retriesLeft == 0) {
               // forward to live agent
               agent.setFollowupEvent(constants.events.TalkToAgent)
               // does not actually have any impact, event overrides the response
               // but we have to declare at least 1 response for each path or error is thrown
               agent.add("Please hold, you will be connected to a live agent shortly")
            } else {
               agent.context.set(constants.contexts.UnknownUtterance.name, constants.contexts.UnknownUtterance.lifespan, { retriesLeft: retriesLeft - 1 });
               agent.add("Could you please repeat that?")
            }
         }

         var endTime = performance.now()
         console.log(`Query "${agent.query}" answered in ${endTime - startTime}ms`)
      }



   // Run the proper function handler based on the matched Dialogflow intent name
   let intentMap = new Map();
   intentMap.set(constants.intents.DEFAULT_WELCOME, welcome);
   intentMap.set(constants.intents.FALLBACK, fallback);
   agent.handleRequest(intentMap);
});


/**
   * Check if Aisera matched a user utterance to an intent based on chatbot response
   *
   * @param {string}   aisera_response               Response of chatbot server
   *
   * @return {boolean} True if matched, false if didn't match
   */   
   function _aiseraMatchedIntent(aisera_response) {
      return !aisera_response.includes("Oh No, looks like something is wrong")
   }

/**
   * Check if Aisera partially matched a user utterance to an intent based on chatbot response
   *
   * @param {string}   aisera_response               Response of chatbot server
   *
   * @return {boolean} True if partially matched, false if didn't match partially
   */   
   function _aiseraPartialMatchedIntent(aisera_response) {
      return aisera_response.includes("I am not sure I understand")
   }

/**
   * Reset the unknown utterance retries left to the user before forwarding them to a live agent
   *
   * @param agent      Dialogflow webhook client constructed based on an incoming request
   */   
   function _resetUnknownUtteranceRetries(agent) {
      agent.context.set(constants.contexts.UnknownUtterance.name, constants.contexts.UnknownUtterance.lifespan, { retriesLeft: constants.contexts.UnknownUtterance.params.retries });
   }

/**
   * Send user utterance to an Aisera chatbot instance.
   *
   * @param {string}   userUtterance                 User query to be sent to aisera.
   * @param {string}   chatbot                       Chatbot instance to send the query to (dev0 / demo9)
   * @param {string}   user                          User to send the utterance as
   *
   * @return {Promise} Promise awaiting for aisera response
   */   
   async function _askAisera(userUtterance, chatbot, user) {
      const body = {
         "userId": user,
         "channelId": chatbot.channel_id,
         "text": userUtterance
      }

      const headers = {
         'Authorization': chatbot.auth_header,
         'Content-Type': "application/json"
      }

      try {
         let res = await axios.post(`https://${chatbot.host}/ivr/receive`, body, {headers: headers});
         let ans = res.data.answers[0].text;
         // if aisera almost matched an intent, respond with possible intents
         if (_aiseraPartialMatchedIntent(ans)) {
            ans = res.data.answers.map(answer => answer.text).join(",")
         }
         return ans
      } catch (e) {
         console.log(`Error connecting to aisera server: ${e}`)
         return "There seems to be a problem. Please try again later."
      }

   }


/**
   * Gets agent output context based on context name
   *
   * @param agent      Dialogflow webhook client constructed based on an incoming request
   *
   * @return {Object} Output context that matched the name or undefined if no match
   */   
   function _getContext(agent, name) {
      return agent.contexts.filter(context => context.name == name).pop()
   }

/**
   * Resets user conversation context with Aisera
   *
   * @param {string} chatbot     Aisera chatbot to reset conv context with
   * @param {string} user        User to reset context for
   *
   * @return {Promise} Promise awaiting Aisera response
   */   
   async function _resetAiseraConvContext(chatbot, user) {
      return await _askAisera('exit', chatbot, user)
   }
