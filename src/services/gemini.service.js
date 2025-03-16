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

  const cleanJson = response.text().replace(/^```(json|javascript)\n|\n```$/g, '').trim();
  console.log('query',response.text());
  return cleanJson;
}
 
module.exports = {chatWithGeminiCategory, chatWithGeminiQuery, chatWithgeminiResponse};
