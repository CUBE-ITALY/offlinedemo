sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], (Controller, JSONModel, MessageToast, MessageBox) => {
    "use strict";

    const DB_NAME    = "offlinedemo_db";
    const DB_VERSION = 2;
    const STORE_NAME = "orders";
    const OLD_STORE  = "pending_orders";

    const STATUS = {
        PENDING: { key: "pending", label: "In attesa",      state: "Warning" },
        SENT:    { key: "sent",    label: "Inviato",        state: "Success" },
        SYNCED:  { key: "synced",  label: "Sincronizzato ed Inviato",  state: "Success" }
    };
  
    const PROBE_TIMEOUT = 3000;              

    return Controller.extend("offlinedemo.controller.OfflineDemo", {

        // INIT
        onInit() {
            this._oOrderModel = new JSONModel({ orders: [] });
            this.getView().setModel(this._oOrderModel, "ordine");

            // Stato di connettività interno
            this._bOnline = false;

            this._fnOnline  = this._onNetworkEvent.bind(this, "online");
            this._fnOffline = this._onNetworkEvent.bind(this, "offline");

            const CapNet = window.Capacitor?.isNativePlatform?.() === true && window.Capacitor?.Plugins?.Network;
            if (CapNet) {
                CapNet.addListener("networkStatusChange", (status) => {
                    if (status.connected) { this._fnOnline(); }
                    else                  { this._fnOffline(); }
                });
                this._capNetListener = CapNet;
            } else {
                window.addEventListener("online",  this._fnOnline);
                window.addEventListener("offline", this._fnOffline);
            }

            // UI iniziale
            this._setNetworkUIState("checking");

            this._initAudio();

            this._initDB()
                .then(() => this._reloadFromDB())
                .then(() => this._probeConnectivity())
                .catch((err) => {
                    MessageBox.error("Errore inizializzazione: " + err.message);
                });
        },

        onExit() {
            if (this._capNetListener) {
                if (typeof this._capNetListener.removeAllListeners === "function") {
                    this._capNetListener.removeAllListeners();
                } else if (typeof this._capNetListener.remove === "function") {
                    this._capNetListener.remove();
                }
                this._capNetListener = null;
            } else {
                window.removeEventListener("online",  this._fnOnline);
                window.removeEventListener("offline", this._fnOffline);
            }
            if (this._db) {
                this._db.close();
                this._db = null;
            }
            if (this._oAudioCtx) {
                this._oAudioCtx.close();
                this._oAudioCtx = null;
            }
        },

        
        _probeConnectivity() {

            const CapNet = window.Capacitor?.isNativePlatform?.() === true && window.Capacitor?.Plugins?.Network;
            if (CapNet) {
                return CapNet.getStatus().then((status) => {
                    this._setOnlineState(status.connected);
                });
            }

            if (navigator.onLine === false) {
                this._setOnlineState(false);
                return Promise.resolve();
            }
           
            const sUrl = sap.ui.require.toUrl("offlinedemo/manifest.json") + "?_probe=" + Date.now();

            const ctrl = new AbortController();
            const tid  = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT);

            return fetch(sUrl, {
                method: "GET",
                cache: "no-store",
                signal: ctrl.signal
            }).then((res) => {
                clearTimeout(tid);
                this._setOnlineState(res.ok);
            }).catch(() => {
                clearTimeout(tid);
                this._setOnlineState(false);
            });
        },

        // Gestione eventi browser
        _onNetworkEvent(sType) {
            if (sType === "offline") {
                this._setOnlineState(false);
            } else {
                // Placeholder "Checking..." fino a verifica
                this._setNetworkUIState("checking");
                this._probeConnectivity();
            }
        },

        // Aggiorna stato interno
        _setOnlineState(bOnline) {
            const bWasOnline = this._bOnline;
            this._bOnline = bOnline;

            this._setNetworkUIState(bOnline ? "online" : "offline");

            if (bWasOnline !== bOnline) {
                if (bOnline) {
                    MessageToast.show("Connessione disponibile");
                    this._reloadFromDB();
                } else {
                    MessageToast.show("Dispositivo offline — gli ordini verranno salvati localmente");
                }
            }
        },

        _setNetworkUIState(sState) {
            const oStatus = this.byId("networkStatus");
            if (!oStatus) return;
            if (sState === "online") {
                oStatus.setText("Online");
                oStatus.setState("Success");
                oStatus.setIcon("sap-icon://connected");
            } else if (sState === "offline") {
                oStatus.setText("Offline");
                oStatus.setState("Error");
                oStatus.setIcon("sap-icon://disconnected");
            } else {
                // "checking"
                oStatus.setText("Verifica...");
                oStatus.setState("Information");
                oStatus.setIcon("sap-icon://synchronize");
            }
        },

        // SUBMIT ORDINE
        onSubmitOrder() {
            const sOrderId   = this.byId("inputOrderId").getValue().trim();
            const sRecipient = this.byId("inputRecipient").getValue().trim();
            const sAddress   = this.byId("inputAddress").getValue().trim();
            const sNotes     = this.byId("inputNotes").getValue().trim();

            if (!sOrderId || !sRecipient || !sAddress) {
                MessageBox.warning("Compila tutti i campi obbligatori.");
                return;
            }

            // Probe connessione di test prima di inserimenti
            this._probeConnectivity().then(() => {
                const oSigPad = this.byId("sigPad");
                const oOrder = {
                    orderId:   sOrderId,
                    recipient: sRecipient,
                    address:   sAddress,
                    notes:     sNotes,
                    timestamp: new Date().toISOString(),
                    status:    this._bOnline ? STATUS.SENT.key : STATUS.PENDING.key,
                    signature: oSigPad.isEmpty() ? null : oSigPad.getSignatureBundle()
                };

                this._addToDB(oOrder).then(() => {
                    this._applyStatusFields(oOrder);
                    this._prependToList(oOrder);
                    this._clearForm();
                    this._refreshQueueUI();

                    if (this._bOnline) {
                        MessageToast.show("Ordine " + oOrder.orderId + " registrato");
                        this._playNotification("sent"); // trigger notifica
                    } else {
                        MessageToast.show("Ordine salvato localmente — verrà sincronizzato al rientro");
                        this._playNotification("pending"); // trigger notifica
                    }
                }).catch((err) => {
                    if (err.name === "ConstraintError" || /constraint/i.test(err.message)) {
                        MessageBox.error(
                            "Esiste già un ordine con numero \"" + sOrderId + "\". " +
                            "Usa un identificativo diverso."
                        );
                        this.byId("inputOrderId").focus();
                    } else {
                        MessageBox.error("Errore nel salvataggio: " + err.message);
                    }
                });
            });
        },

        // SYNC
        onSyncQueue() {
            // Probe di connessione test prima di sync
            this._probeConnectivity().then(() => {
                if (!this._bOnline) {
                    MessageBox.warning("Impossibile sincronizzare: dispositivo offline.");
                    return;
                }

                return this._getByStatusFromDB(STATUS.PENDING.key).then((aPending) => {
                    if (!aPending.length) {
                        MessageToast.show("Nessun ordine da sincronizzare.");
                        return;
                    }

                    const aPromises = aPending.map((oOrder) =>
                        this._sendOrderToBackend(oOrder)
                            .then(() => ({ ok: true,  order: oOrder }))
                            .catch((err) => ({ ok: false, order: oOrder, err }))
                    );

                    return Promise.all(aPromises).then((aResults) => {
                        const aOk = aResults.filter(r => r.ok).map(r => r.order);
                        const aKo = aResults.filter(r => !r.ok);

                        return Promise.all(
                            aOk.map((o) => {
                                o.status = STATUS.SYNCED.key;
                                return this._putToDB(o);
                            })
                        ).then(() => this._reloadFromDB()).then(() => {
                            if (aKo.length) {
                                MessageBox.warning(
                                    aOk.length + " sincronizzati, " + aKo.length + " rimasti in coda."
                                );
                            } else {
                                MessageToast.show(aOk.length + " ordini sincronizzati");
                                this._playNotification("synced"); // trigger notifica
                            }
                        });
                    });
                });
            }).catch((err) => {
                MessageBox.error("Errore durante la sincronizzazione: " + err.message);
            });
        },

        // TEST CONNESSIONE SAP — richiede VPN attiva
        // Dev server: URL relativo → proxy ui5.yaml gestisce CORS
        // Capacitor Android: URL assoluto → fetch nativo bypassa CORS
        onTestSapConnection() {
            const oStatus = this.byId("sapTestStatus");
            oStatus.setText("Verifica...");
            oStatus.setState("Information");
            oStatus.setIcon("sap-icon://synchronize");

            const sBase = window.Capacitor?.isNativePlatform?.() === true
                ? "https://vhlmxl4dci.sap.lasmobili.it:44300"
                : "";
            const sUrl  = sBase + "/sap/opu/odata/sap/ZCU_DELIVERY_CONTROL_SRV/probeSet?$format=json";
            const sAuth = "Basic " + btoa("CUBE_ABAP:Tortoreto2025@@");
            const ctrl  = new AbortController();
            const tid   = setTimeout(() => ctrl.abort(), 8000);

            fetch(sUrl, {
                method: "GET",
                headers: { "Authorization": sAuth },
                cache: "no-store",
                signal: ctrl.signal
            }).then((res) => {
                clearTimeout(tid);
                console.log("[SAP Test] status:", res.status, "url:", sUrl);
                return res.text().then((sBody) => {
                    console.log("[SAP Test] body preview:", sBody.substring(0, 2000));
                    if (!res.ok) {
                        oStatus.setText("HTTP " + res.status + (res.statusText ? " " + res.statusText : ""));
                        oStatus.setState("Error");
                        oStatus.setIcon("sap-icon://error");
                        return;
                    }
                    const sType = res.headers.get("content-type") || "";
                    if (sType.includes("text/html")) {
                        // Il proxy ha restituito l'SPA (index.html) invece del backend SAP.
                        // Causa tipica: VPN non attiva o backend non raggiungibile in modalità web.
                        oStatus.setText("Proxy non raggiungibile — verificare connessione VPN");
                        oStatus.setState("Error");
                        oStatus.setIcon("sap-icon://disconnected");
                        return;
                    }
                    try {
                        const data   = JSON.parse(sBody);
                        const bCheck = data?.d?.results?.[0]?.checkConnection;
                        oStatus.setText("SAP OK — checkConnection: " + bCheck);
                        oStatus.setState("Success");
                        oStatus.setIcon("sap-icon://accept");
                    } catch (e) {
                        const sPreview = sBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 120);
                        oStatus.setText(
                            "HTTP " + res.status + " — risposta non JSON\n" +
                            "Tipo: " + sType + "\n" +
                            "VPN: verificare connessione VPN sul dispositivo\n" +
                            "Body: " + sPreview
                        );
                        oStatus.setState("Warning");
                        oStatus.setIcon("sap-icon://warning");
                    }
                });
            }).catch((err) => {
                clearTimeout(tid);
                const sMsg = err.name === "AbortError" ? "Timeout (8s)" : err.message;
                oStatus.setText("Connessione fallita: " + sMsg);
                oStatus.setState("Error");
                oStatus.setIcon("sap-icon://disconnected");
            });
        },

        _sendOrderToBackend(oOrder) {
            return new Promise((resolve) => {
                setTimeout(() => resolve(oOrder), 300);
            });
        },

        // PULIZIA STORICO
        onClearHistory() {
            this._getAllFromDB().then((aAll) => {
                const aRemovable = aAll.filter(o =>
                    o.status === STATUS.SENT.key || o.status === STATUS.SYNCED.key
                );

                if (!aRemovable.length) {
                    MessageToast.show("Nessun ordine completato da rimuovere.");
                    return;
                }

                MessageBox.confirm(
                    "Rimuovere " + aRemovable.length + " ordini completati dallo storico?\n" +
                    "Gli ordini in attesa di sincronizzazione verranno mantenuti.",
                    {
                        title: "Pulisci storico",
                        onClose: (sAction) => {
                            if (sAction !== MessageBox.Action.OK) return;
                            Promise.all(aRemovable.map(o => this._deleteFromDB(o.orderId)))
                                .then(() => this._reloadFromDB())
                                .then(() => MessageToast.show(aRemovable.length + " ordini rimossi"))
                                .catch((err) => MessageBox.error("Errore: " + err.message));
                        }
                    }
                );
            });
        },

        // RICARICA STATO
        _reloadFromDB() {
            if (!this._db) return Promise.resolve();
            return this._getAllFromDB().then((aOrders) => {
                aOrders.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
                aOrders.forEach((o) => this._applyStatusFields(o));
                this._oOrderModel.setProperty("/orders", aOrders);
                this._refreshQueueUI(aOrders);
            });
        },

        _applyStatusFields(oOrder) {
            const st = Object.values(STATUS).find(s => s.key === oOrder.status) || STATUS.PENDING;
            oOrder.statusLabel = st.label;
            oOrder.statusState = st.state;
        },

        // UI HELPERS
        _prependToList(oOrder) {
            const aOrders = this._oOrderModel.getProperty("/orders");
            aOrders.unshift(oOrder);
            this._oOrderModel.setProperty("/orders", aOrders);
        },

        _clearForm() {
            this.byId("inputOrderId").setValue("");
            this.byId("inputRecipient").setValue("");
            this.byId("inputAddress").setValue("");
            this.byId("inputNotes").setValue("");
            this.byId("sigPad").clear();
        },

        onSigClear() {
            this.byId("sigPad").clear();
        },

        onSigChange() {
            // Firma raccolta automaticamente al submit — nessuna azione immediata
        },

        _refreshQueueUI(aOrders) {
            const fnUpdate = (aAll) => {
                const oPanel = this.byId("panelQueue");
                const oCount = this.byId("queueCount");
                if (!oPanel || !oCount) return;

                const n = aAll.filter(o => o.status === STATUS.PENDING.key).length;
                oPanel.setVisible(n > 0);
                oCount.setText(n + (n === 1 ? " ordine in coda" : " ordini in coda"));
            };

            if (aOrders) {
                fnUpdate(aOrders);
            } else {
                this._getAllFromDB().then(fnUpdate);
            }
        },

        // INDEXEDDB 
        _initDB() {
            return new Promise((resolve, reject) => {
                const oRequest = indexedDB.open(DB_NAME, DB_VERSION);

                oRequest.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    const tx = event.target.transaction;

                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        const store = db.createObjectStore(STORE_NAME, { keyPath: "orderId" });
                        store.createIndex("by_status", "status", { unique: false });
                    }

                    if (db.objectStoreNames.contains(OLD_STORE)) {
                        const oldStore = tx.objectStore(OLD_STORE);
                        const newStore = tx.objectStore(STORE_NAME);
                        oldStore.openCursor().onsuccess = (e) => {
                            const cursor = e.target.result;
                            if (cursor) {
                                const rec = cursor.value;
                                rec.status = rec.status || STATUS.PENDING.key;
                                newStore.put(rec);
                                cursor.continue();
                            } else {
                                db.deleteObjectStore(OLD_STORE);
                            }
                        };
                    }
                };

                oRequest.onsuccess = (event) => {
                    this._db = event.target.result;
                    this._db.onversionchange = () => {
                        this._db.close();
                        this._db = null;
                        MessageBox.information(
                            "L'applicazione è stata aggiornata in un'altra finestra. " +
                            "Ricarica la pagina per continuare."
                        );
                    };
                    resolve();
                };

                oRequest.onerror = (event) => {
                    reject(new Error("Apertura IndexedDB fallita: " + event.target.error));
                };

                oRequest.onblocked = () => {
                    MessageBox.warning(
                        "Aggiornamento storage bloccato da un'altra finestra. " +
                        "Chiudi le altre tab e riprova."
                    );
                };
            });
        },

        _addToDB(oOrder) {
            return new Promise((resolve, reject) => {
                const tx    = this._db.transaction(STORE_NAME, "readwrite");
                const store = tx.objectStore(STORE_NAME);
                const req   = store.add(oOrder);
                req.onsuccess = () => resolve();
                req.onerror = (e) => {
                    const err = e.target.error;
                    const out = new Error(err && err.message || "Errore IndexedDB");
                    out.name = err && err.name || "UnknownError";
                    reject(out);
                };
            });
        },

        _putToDB(oOrder) {
            return new Promise((resolve, reject) => {
                const tx    = this._db.transaction(STORE_NAME, "readwrite");
                const store = tx.objectStore(STORE_NAME);
                const req   = store.put(oOrder);
                req.onsuccess = () => resolve();
                req.onerror   = (e) => reject(new Error(e.target.error));
            });
        },

        _getAllFromDB() {
            return new Promise((resolve, reject) => {
                const tx    = this._db.transaction(STORE_NAME, "readonly");
                const store = tx.objectStore(STORE_NAME);
                const req   = store.getAll();
                req.onsuccess = (e) => resolve(e.target.result || []);
                req.onerror   = (e) => reject(new Error(e.target.error));
            });
        },

        _getByStatusFromDB(sStatus) {
            return new Promise((resolve, reject) => {
                const tx    = this._db.transaction(STORE_NAME, "readonly");
                const store = tx.objectStore(STORE_NAME);
                const idx   = store.index("by_status");
                const req   = idx.getAll(sStatus);
                req.onsuccess = (e) => resolve(e.target.result || []);
                req.onerror   = (e) => reject(new Error(e.target.error));
            });
        },

        _deleteFromDB(sOrderId) {
            return new Promise((resolve, reject) => {
                const tx    = this._db.transaction(STORE_NAME, "readwrite");
                const store = tx.objectStore(STORE_NAME);
                const req   = store.delete(sOrderId);
                req.onsuccess = () => resolve();
                req.onerror   = (e) => reject(new Error(e.target.error));
            });
        },

        // AUDIO PLAYBACK
        _initAudio() {
            this._mAudioBuffers = {};
            this._mSoundPaths = {
                sent:    "offlinedemo/media/sounds/Chord2.wav",
                pending: "offlinedemo/media/sounds/Cloud.wav",
                synced:  "offlinedemo/media/sounds/Chord2_Rev.wav",
                error:   "offlinedemo/media/sounds/Chord2.wav"
            };

            try {
                this._oAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {
                console.warn("[Audio] AudioContext non supportato:", e.message);
                return;
            }

            const ctx = this._oAudioCtx;
            const buffers = this._mAudioBuffers;
            const loaded = new Set();

            Object.values(this._mSoundPaths).forEach(sPath => {
                if (loaded.has(sPath)) return;
                loaded.add(sPath);

                fetch(sap.ui.require.toUrl(sPath))
                    .then(r => r.arrayBuffer())
                    .then(ab => ctx.decodeAudioData(ab))
                    .then(buffer => { buffers[sPath] = buffer; })
                    .catch(err => console.warn("[Audio] Pre-load fallito:", sPath, err.message));
            });
        },

        async _playNotification(sAlertType) {
            const sPath = this._mSoundPaths?.[sAlertType];
            if (!sPath || !this._oAudioCtx) return;

            const buffer = this._mAudioBuffers[sPath];
            if (!buffer) {
                console.warn("[Audio] Buffer non ancora disponibile:", sAlertType);
                return;
            }

            try {
                if (this._oAudioCtx.state === "suspended") {
                    await this._oAudioCtx.resume();
                }
                const source = this._oAudioCtx.createBufferSource();
                source.buffer = buffer;
                source.connect(this._oAudioCtx.destination);
                source.start(0);
            } catch (err) {
                console.warn("[Audio] Riproduzione bloccata:", err.message);
            }
        },

    });
});