const Message = require('../models/message.model');

async function executeMongooseQuery(query){

  const response = await Message.aggregate(query);
  return response;
}

async function executeMongooseQueryEval(queryString) {
  try {
    // Convert the query string to an executable function
    const queryFunction = new Function("Message", `return ${queryString};`);

    // Execute the aggregation pipeline
    const result = await queryFunction(Message);

    return { status: "success", data: result };
  } catch (error) {
    console.error("Query Execution Error:", error);
    return { status: "error", message: error.message };
  }
}




module.exports =  { executeMongooseQuery, executeMongooseQueryEval}