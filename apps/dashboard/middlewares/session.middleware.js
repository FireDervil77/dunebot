const session = require("express-session");
require("dotenv").config();

const DB_TYPE = process.env.DB_TYPE
const COOKIE_NAME = process.env.SESSION_COOKIE || "connect.sid";
const SECRET = process.env.SESSION_SECRET || "change-me";
const MAX_AGE = 336 * 60 * 60 * 1000; // original: 336 hours

const sessionOptions = {
    secret: SECRET,
    cookie: { maxAge: MAX_AGE },
    name: COOKIE_NAME,
    resave: true,
    saveUninitialized: false,
};

if (DB_TYPE === "mysql") {
    // express-mysql-session expects the session instance to be passed
    const MySQLStoreFactory = require("express-mysql-session")(session);
    const options = {
        host: process.env.MYSQL_HOST || "localhost",
        port: Number(process.env.MYSQL_PORT) || 3306,
        user: process.env.MYSQL_USER || "root",
        password: process.env.MYSQL_PASSWORD || "",
        database: process.env.MYSQL_DATABASE || "dunebot",
        createDatabaseTable: true,
        schema: {
            tableName: process.env.SESSION_TABLE || "sessions",
            columnNames: {
                session_id: "session_id",
                expires: "expires",
                data: "data",
            },
        },
    };

    // Optionally reuse an existing connection pool object if provided via env (not required)
    // If you have a DBService exposing a pool, pass it as `connection` in options.
    sessionOptions.store = new MySQLStoreFactory(options);
} 

module.exports = session(sessionOptions);