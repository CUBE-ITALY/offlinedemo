/* global QUnit */
QUnit.config.autostart = false;

sap.ui.require(["offlinedemo/test/integration/AllJourneys"
], function () {
	QUnit.start();
});
