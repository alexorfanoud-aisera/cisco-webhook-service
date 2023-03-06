var express = require('express');
var { dialogflowFirebaseFulfillment } = require('./index.js')

var app = express();
app.use(express.json());

app.post('/', async (req, res) => {
  dialogflowFirebaseFulfillment(req, res) 
});
  
app.listen(3001, function () {
    console.log(`Example app listening on port 3001. Connected to bot demo9`);
});
