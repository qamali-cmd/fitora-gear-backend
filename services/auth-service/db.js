// db.js
// Ito ang koneksyon papunta sa MySQL database gamit ang mysql2 library.
// Ginagamit ito ng ibang files (hal. server.js) para makapag-query sa database.

require('dotenv').config();
const mysql = require('mysql2/promise');

// Gumagawa tayo ng "pool" ng connections (mas efficient kesa isa-isang connection)
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;