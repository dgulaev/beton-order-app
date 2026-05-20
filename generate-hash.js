// generate-hash.js
const bcrypt = require('bcryptjs');

const password = "dag197126";   // ←←← ИЗМЕНИ НА СВОЙ ПАРОЛЬ

async function generateHash() {
  const saltRounds = 12;
  const hash = await bcrypt.hash(password, saltRounds);
  
  console.log("=====================================");
  console.log("Пароль:", password);
  console.log("Hash для вставки в базу:");
  console.log(hash);
  console.log("=====================================");
}

generateHash();