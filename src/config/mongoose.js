const mongoose = require('mongoose');
require('dotenv').config();

let connected = false;

async function connect() {
  if (connected) return mongoose.connection;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  const dbName = process.env.MONGO_DB_NAME || 'sfjpii';
  const options = {
    family: 4,
    serverSelectionTimeoutMS: 8000,
    dbName
  };
  mongoose.connection.on('connected', () => { connected = true; });
  mongoose.connection.on('error', () => { connected = false; });
  mongoose.connection.on('disconnected', () => { connected = false; });
  await mongoose.connect(uri, options);
  return mongoose.connection;
}

module.exports = { connect };
