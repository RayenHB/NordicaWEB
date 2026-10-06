const { initDB } = require("./database");

initDB()
  .then(() => {
    console.log("Database initialization completed.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });