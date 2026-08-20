# Flavour Blaster Sales Dashboard

Static Claude Design export for the Flavour Blaster multi-channel sales dashboard.

## Working source

`Sales Dashboard v2.dc.html` is the current editable dashboard source. It uses deterministic sample data and does not connect to a live sales backend.

Supporting runtime and design-system files are stored in `support.js` and `_ds/`.

## Local preview

```sh
python3 -m http.server 3001
```

Then open:

`http://127.0.0.1:3001/Sales%20Dashboard%20v2.dc.html`

## Deployment

The project is configured as a static Vercel site. The root entry point opens the v2 dashboard source, and `vercel.json` also defines the equivalent root rewrite.
