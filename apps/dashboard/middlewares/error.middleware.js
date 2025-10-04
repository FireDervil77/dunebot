/**
 * Middleware for handling server errors
 * @param {Error} error
 * @param {import('express').Request} _req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
module.exports = (error, req, res, next) => {
    console.error("=== ERROR MIDDLEWARE ===");
    console.error(error);

    const status = error.status || 500;
    const message = process.env.NODE_ENV === "development" ? error.stack || error.message : error.message;

    // sichere Defaults, damit Partials nicht crashen
    const safeUser = req.session?.user?.info || { id: "", avatar: "" };
    const safeGuilds = Array.isArray(req.session?.user?.guilds) ? req.session.user.guilds : [];

    // Render ohne Layout (vermeidet inkludieren von header/sidebar) oder mit sicheren locals
    return res.status(status).render("error", {
        error: error.message || "Internal Server Error",
        message: message,
        status,
        user: safeUser,
        guilds: safeGuilds,
        layout: false,
        stack: process.env.NODE_ENV === "development" ? error.stack : null,
    });
};