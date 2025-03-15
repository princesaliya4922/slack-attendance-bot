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

Message.aggregate([
  {
    $match: {
      category: { $in: ["FDL", "HDL"] },
      start_time: {
        $gte: new Date(new Date().getFullYear(), Math.floor(new Date().getMonth() / 3) * 3, 1),
        $lt: new Date(new Date().getFullYear(), Math.floor(new Date().getMonth() / 3) * 3 + 3, 1)
      }
    }
  },
  {
    $group: {
      _id: "$user",
      username: { $first: "$username" },
      totalFullDayLeaves: { $sum: { $cond: [{ $eq: ["$category", "FDL"] }, 1, 0] } },
      totalHalfDayLeaves: { $sum: { $cond: [{ $eq: ["$category", "HDL"] }, 1, 0] } },
      groupedDocuments: { $push: "$$ROOT" }
    }
  },
  { $sort: { totalFullDayLeaves: -1 } },
  { $limit: 1 }
]).then(res=>console.log(res))





module.exports =  { executeMongooseQuery, executeMongooseQueryEval}