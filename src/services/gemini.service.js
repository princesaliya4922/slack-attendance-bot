const { GoogleGenerativeAI } = require("@google/generative-ai");
const Message = require("../models/message.model");
const API_KEY = "AIzaSyB1LntCRcqpSBc6oXzAlKRgRNHWx6ywAqQ";
const genAI = new GoogleGenerativeAI(API_KEY);
const {geminiCategoryPromptFinal, geminiQueryPromptFinal,geminiResponsePromptFinal} = require('./prompts')

const now = new Date()
const currentTime = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
const currentDay = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata", weekday: "long" });

async function chatWithGeminiCategory(prompt) { 
  const finalMsg = geminiCategoryPromptFinal(prompt);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const result = await model.generateContent(finalMsg);
  const response = result.response;

  // console.log("geminiRes: ",response.text())

  const match = response.text().match(/<response>\s*([\s\S]*?)\s*<\/response>/);
  const finalResult = match ? match[1].trim() : null
  const cleanJson = finalResult.replace(/^```(json|javascript)\n|\n```$/g, '').trim();
  console.log(cleanJson); 
  return JSON.parse(cleanJson);
}
 
// chatWithGeminiGeneral('just going to have a coffee for a couple of hours now.');

async function chatWithGeminiQuery(prompt) {

  const finalMsg = geminiQueryPromptFinal(prompt)
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const result = await model.generateContent(finalMsg);
  const response = result.response;
  console.log(response.text())
  const match = response.text().match(/<response>\s*([\s\S]*?)\s*<\/response>/);
  const finalResult = match ? match[1].trim() : null
  const cleanJson = finalResult.replace(/^```(json|javascript)\n|\n```$/g, '').trim();
  console.log(cleanJson);
  return cleanJson;
}

// queryGemini('Who has taken most leaves this month?');

async function chatWithgeminiResponse(prompt) {

  const finalMsg = geminiResponsePromptFinal(prompt);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const result = await model.generateContent(finalMsg);
  const response = result.response;

  console.log('GeminiREsponse: ', response.text());
  const match = response.text().match(/<response>\s*([\s\S]*?)\s*<\/response>/);
  const finalResult = match ? match[1].trim() : null
  const cleanJson = finalResult.replace(/^```(json|javascript|slack)\n|\n```$/g, '').trim();
  console.log('query',response.text());
  return cleanJson;
}
 

/**
 * Call the Gemini API
 * @param {string} prompt - The prompt to send to Gemini
 * @returns {Promise<string>} - The response from Gemini
 */
async function callGeminiAPI(prompt) {
  // This is a placeholder - replace with your actual implementation of calling Gemini
  // You'd typically use the Google AI API client library here
  
  // For testing purposes, you can return a mock response
  // In production, replace this with actual API call
  
  /* 
  Example implementation with the Google AI Node.js client:
  
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
  
  const result = await model.generateContent(prompt);
  return result.response.text();
  */

  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const result = await model.generateContent(prompt);
  const response = result.response.text();
  const cleanJson = response.replace(/^```(json|javascript)\n|\n```$/g, '').trim();
  return JSON.stringify(cleanJson);
  
  // For now, return a placeholder response
  return JSON.stringify({
    action: "INSERT",
    leavesToInsert: [
      {
        ...newLeave,
        start_time: newLeave.start_time.toISOString(),
        end_time: newLeave.end_time.toISOString(),
      }
    ],
    leavesToDelete: [],
    leavesToUpdate: [],
    explanation: "This is a placeholder response. Replace with actual Gemini API call in production."
  });
}

module.exports = {chatWithGeminiCategory, chatWithGeminiQuery, chatWithgeminiResponse, callGeminiAPI};
