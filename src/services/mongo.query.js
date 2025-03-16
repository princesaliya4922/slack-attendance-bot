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


// MongoDB Mongoose query to find who took the most leaves last month
// Message.aggregate([
//   {
//     $match: {
//       category: { $in: ["FDL", "HDL", "WFH", "LTO", "LE", "OOO"] },
//       start_time: {
//         $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
//         $lt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
//       }
//     }
//   },
//   {
//     $group: {
//       _id: "$user",
//       username: { $first: "$username" },
//       totalFullDayLeaves: { $sum: { $cond: [{ $eq: ["$category", "FDL"] }, 1, 0] } },
//       totalHalfDayLeaves: { $sum: { $cond: [{ $eq: ["$category", "HDL"] }, 0.5, 0] } },
//       totalWFH: { $sum: { $cond: [{ $eq: ["$category", "WFH"] }, 1, 0] } },
//       totalLTO: { $sum: { $cond: [{ $eq: ["$category", "LTO"] }, 1, 0] } },
//       totalLE: { $sum: { $cond: [{ $eq: ["$category", "LE"] }, 1, 0] } },
//       totalOOO: { $sum: { $cond: [{ $eq: ["$category", "OOO"] }, 1, 0] } },
//       groupedDocuments: { $push: "$$ROOT" }
//     }
//   },
//   {
//     $addFields: {
//       totalLeaves: {
//         $add: [
//           "$totalFullDayLeaves",
//           "$totalHalfDayLeaves",
//           "$totalWFH",
//           "$totalLTO",
//           "$totalLE",
//           "$totalOOO"
//         ]
//       }
//     }
//   },
//   { $sort: { totalLeaves: -1 } },
//   { $limit: 1 },
//   {
//     $project: {
//       _id: 0,
//       user: "$_id",
//       username: 1,
//       totalLeaves: 1,
//       breakdown: {
//         fullDayLeaves: "$totalFullDayLeaves",
//         halfDayLeaves: "$totalHalfDayLeaves",
//         workFromHome: "$totalWFH",
//         lateToOffice: "$totalLTO",
//         leavingEarly: "$totalLE",
//         outOfOffice: "$totalOOO"
//       },
//       groupedDocuments: 1
//     }
//   }
// ]).then((res)=>console.log(res))


module.exports =  { executeMongooseQuery, executeMongooseQueryEval}