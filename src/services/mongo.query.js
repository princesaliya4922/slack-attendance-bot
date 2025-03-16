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
//       username: { $regex: '^Prince Saliya$', $options: 'i' },
//       start_time: {
//         $gte: new Date(2025, 2, 1), // March 1, 2025 (month is 0-indexed)
//         $lt: new Date(2025, 3, 1)   // April 1, 2025
//       }
//     }
//   },
//   {
//     $group: {
//       _id: "$category",
//       count: { $sum: 1 },
//       leaves: { $push: "$$ROOT" }
//     }
//   },
//   {
//     $sort: { _id: 1 }
//   },
//   {
//     $group: {
//       _id: null,
//       categoryCounts: { $push: { category: "$_id", count: "$count" } },
//       totalLeaves: { $sum: "$count" },
//       allLeaves: { $push: "$leaves" }
//     }
//   },
//   {
//     $project: {
//       _id: 0,
//       employeeName: "Prince Saliya",
//       month: "March 2025",
//       totalLeaves: 1,
//       categoryCounts: 1,
//       leaveDetails: {
//         $reduce: {
//           input: "$allLeaves",
//           initialValue: [],
//           in: { $concatArrays: ["$$value", "$$this"] }
//         }
//       }
//     }
//   },
//   {
//     $unwind: "$leaveDetails"
//   },
//   {
//     $sort: { "leaveDetails.start_time": 1 }
//   },
//   {
//     $group: {
//       _id: null,
//       employeeName: { $first: "$employeeName" },
//       month: { $first: "$month" },
//       totalLeaves: { $first: "$totalLeaves" },
//       categoryCounts: { $first: "$categoryCounts" },
//       leaveDetails: { $push: "$leaveDetails" }
//     }
//   },
//   {
//     $project: {
//       _id: 0,
//       employeeName: 1,
//       month: 1,
//       totalLeaves: 1,
//       categoryCounts: 1,
//       leaveDetails: 1
//     }
//   }
// ]).then((res)=>console.log(res))


module.exports =  { executeMongooseQuery, executeMongooseQueryEval}