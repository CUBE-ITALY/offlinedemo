sap.ui.define([
    "sap/ui/core/Control"
], (Control) => {
    "use strict";

    return Control.extend("offlinedemo.control.SignaturePad", {

        metadata: {
            properties: {
                /** Altezza del canvas in px (spazio CSS). */
                height:          { type: "int",    defaultValue: 220 },
                /** Colore del tratto. */
                penColor:        { type: "string", defaultValue: "#003a6b" },
                /** Colore di sfondo del canvas. */
                backgroundColor: { type: "string", defaultValue: "#ffffff" },
                /** Spessore base del tratto (px). Modulato dalla pressione. */
                penWidth:        { type: "float",  defaultValue: 2.0 },
                /** Numero minimo di punti perché la firma sia considerata valida. */
                minPoints:       { type: "int",    defaultValue: 30 },
                /** Durata minima in ms perché la firma sia considerata valida. */
                minDurationMs:   { type: "int",    defaultValue: 500 }
            },
            events: {
                /** Emesso quando viene aggiunto un nuovo punto. */
                change: {}
            }
        },

        renderer: {
            apiVersion: 2,
            render(rm, ctrl) {
                rm.openStart("div", ctrl)
                  .class("offlinedemoSignaturePad")
                  .style("height", ctrl.getHeight() + "px")
                  .style("background", ctrl.getBackgroundColor())
                  .openEnd();
                rm.voidStart("canvas")
                  .attr("data-role", "signature-canvas")
                  .style("width",  "100%")
                  .style("height", "100%")
                  .style("touch-action", "none")
                  .style("display", "block")
                  .style("cursor", "crosshair")
                  .voidEnd();
                rm.close("div");
            }
        },

        // LIFECYCLE

        init() {
            this._strokes      = [];     // [{points: [{x,y,t,p}, ...]}, ...]
            this._currentStroke = null;
            this._startedAt    = null;   // performance.now() del primo punto
            this._activePtrId  = null;   // pointerId attualmente in tracking
            this._dpr          = 1;
        },

        onAfterRendering() {
            const oCanvas = this.getDomRef().querySelector("canvas");
            this._canvas = oCanvas;
            this._ctx    = oCanvas.getContext("2d");

            // Il layout SAP non è ancora stabile in onAfterRendering: defer sizing
            // per leggere getBoundingClientRect() dopo il primo paint.
            requestAnimationFrame(() => { this._resize(); this._redraw(); });

            // Eventi puntatore unificati
            oCanvas.addEventListener("pointerdown",   this._onPointerDown.bind(this));
            oCanvas.addEventListener("pointermove",   this._onPointerMove.bind(this));
            oCanvas.addEventListener("pointerup",     this._onPointerUp.bind(this));
            oCanvas.addEventListener("pointercancel", this._onPointerUp.bind(this));
            oCanvas.addEventListener("pointerleave",  this._onPointerUp.bind(this));

            // Re-fit su resize / rotazione
            this._onResize = this._onResize.bind(this);
            window.addEventListener("resize", this._onResize);
        },

        exit() {
            window.removeEventListener("resize", this._onResize);
        },

        // SIZING / DPR

        _resize() {
            const oCanvas = this._canvas;
            const rect    = oCanvas.getBoundingClientRect();
            this._dpr     = window.devicePixelRatio || 1;
            oCanvas.width  = Math.round(rect.width  * this._dpr);
            oCanvas.height = Math.round(rect.height * this._dpr);
            // Trasforma il contesto perché continui a ragionare in spazio CSS
            this._ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
        },

        _onResize() {
            // Salva il contenuto, ridimensiona, ridisegna dagli stroke (sorgente di verità)
            this._resize();
            this._redraw();
        },

        // POINTER HANDLERS

        _onPointerDown(e) {
            if (this._activePtrId !== null) return; // un dito alla volta
            // Safety net: ricalibra il buffer se le dimensioni CSS sono cambiate
            // (es. layout SAP non ancora stabile al momento di onAfterRendering).
            const _r = this._canvas.getBoundingClientRect();
            if (this._canvas.width  !== Math.round(_r.width  * this._dpr) ||
                this._canvas.height !== Math.round(_r.height * this._dpr)) {
                this._resize();
                this._redraw();
            }
            e.preventDefault();
            this._canvas.setPointerCapture(e.pointerId);
            this._activePtrId = e.pointerId;

            if (this._startedAt === null) this._startedAt = performance.now();

            this._currentStroke = { points: [] };
            this._addPoint(e);
        },

        _onPointerMove(e) {
            if (e.pointerId !== this._activePtrId) return;
            e.preventDefault();
            this._addPoint(e);
        },

        _onPointerUp(e) {
            if (e.pointerId !== this._activePtrId) return;
            e.preventDefault();
            if (this._currentStroke && this._currentStroke.points.length > 0) {
                this._strokes.push(this._currentStroke);
            }
            this._currentStroke = null;
            this._activePtrId   = null;
            this.fireChange();
        },

        _addPoint(e) {
            const rect = this._canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const t = performance.now() - this._startedAt;
            // pressure: 0 quando il browser non la fornisce → fallback 0.5
            const p = (e.pressure && e.pressure > 0) ? e.pressure : 0.5;

            const pt = { x, y, t, p };
            this._currentStroke.points.push(pt);
            this._drawSegment(pt);
            this.fireChange();
        },

        // RENDERING

        _drawSegment(pt) {
            const pts = this._currentStroke.points;
            const ctx = this._ctx;
            ctx.strokeStyle = this.getPenColor();
            ctx.lineCap     = "round";
            ctx.lineJoin    = "round";

            if (pts.length < 2) {
                // primo punto: piccolo dot
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, this.getPenWidth() * pt.p, 0, Math.PI * 2);
                ctx.fillStyle = this.getPenColor();
                ctx.fill();
                return;
            }
            const prev = pts[pts.length - 2];
            ctx.lineWidth = this.getPenWidth() * (0.5 + pt.p); // 0.5x–1.5x base
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(pt.x, pt.y);
            ctx.stroke();
        },

        _redraw() {
            const ctx = this._ctx;
            const rect = this._canvas.getBoundingClientRect();
            ctx.clearRect(0, 0, rect.width, rect.height);
            ctx.fillStyle = this.getBackgroundColor();
            ctx.fillRect(0, 0, rect.width, rect.height);

            for (const stroke of this._strokes) {
                const pts = stroke.points;
                if (!pts.length) continue;
                ctx.strokeStyle = this.getPenColor();
                ctx.lineCap = "round"; ctx.lineJoin = "round";
                for (let i = 1; i < pts.length; i++) {
                    const a = pts[i-1], b = pts[i];
                    ctx.lineWidth = this.getPenWidth() * (0.5 + b.p);
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                    ctx.stroke();
                }
            }
        },

        // API PUBBLICA

        /** Svuota la firma. */
        clear() {
            this._strokes       = [];
            this._currentStroke = null;
            this._startedAt     = null;
            this._redraw();
            this.fireChange();
            return this;
        },

        /** True se la firma è vuota o sotto le soglie di validità. */
        isEmpty() {
            const totalPoints = this._strokes.reduce((n, s) => n + s.points.length, 0);
            if (totalPoints < this.getMinPoints()) return true;
            const last = this._strokes.at(-1)?.points.at(-1);
            if (!last || last.t < this.getMinDurationMs()) return true;
            return false;
        },

        /** Numero totale di punti catturati (utile per UI feedback). */
        getPointCount() {
            return this._strokes.reduce((n, s) => n + s.points.length, 0);
        },

        /** PNG base64 della firma. */
        getDataUrl(sMime = "image/png") {
            return this._canvas.toDataURL(sMime);
        },

        /** Vettore biometrico: array di stroke, ognuno con array di {x,y,t,p}. */
        getStrokes() {
            // Deep clone per evitare mutazioni esterne
            return this._strokes.map(s => ({
                points: s.points.map(p => ({ x: p.x, y: p.y, t: p.t, p: p.p }))
            }));
        },

        /** Bundle pronto per essere persistito/firmato. */
        getSignatureBundle() {
            return {
                version:     1,
                capturedAt:  new Date().toISOString(),
                canvasSize:  {
                    width:  Math.round(this._canvas.getBoundingClientRect().width),
                    height: Math.round(this._canvas.getBoundingClientRect().height)
                },
                strokes:     this.getStrokes(),
                imagePng:    this.getDataUrl("image/png")
            };
        }
    });
});