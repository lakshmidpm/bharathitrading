var express = require('express');
var router = express.Router();




/* GET users listing. */


router.post("/tradedetails", function (req, res) {
console.log(req.params);
res.send("Order Details received");
});


module.exports = router;
