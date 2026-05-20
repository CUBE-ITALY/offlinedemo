/*global QUnit*/

sap.ui.define([
	"offlinedemo/controller/OfflineDemo.controller"
], function (Controller) {
	"use strict";

	QUnit.module("OfflineDemo Controller");

	QUnit.test("I should test the OfflineDemo controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
