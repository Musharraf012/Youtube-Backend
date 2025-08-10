import dotenv from 'dotenv';
import connectDB from './db/index.js';

dotenv.config(
    {
        path: './.env' // Ensure the path to your .env file is correct
    }
);

// Connect to the database
connectDB()
  .then(() => {
    console.log("Database connection successful ✅");
  })
  .catch((err) => {
    console.error("Database connection failed ❌", err);
    process.exit(1);
  });