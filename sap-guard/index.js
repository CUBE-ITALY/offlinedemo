module.exports = () => (req, res, next) => {
    if (!req.path.startsWith("/sap/")) return next();
    res.status(502).json({
        error: "SAP backend non raggiungibile",
        code: "PROXY_FALLTHROUGH",
        hint: "Verificare VPN e raggiungibilità di vhlmxl4dci.sap.lasmobili.it:44300"
    });
};
