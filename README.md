# Vol radar

Installable web app (PWA) showing a daily 5-day volatility forecast and position sizes for 40 markets.

- `index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`: the app (no build step).
- `model/`: the exported Transformer (`vol_transformer.onnx`) and its settings (`vol_config.json`), trained in Colab.
- `scripts/update.py`: downloads prices from Yahoo, runs the model, writes `data/forecast.json`.
- `.github/workflows/daily.yml`: runs the update every day at 22:30 UTC and commits the new forecast.

Run locally: `python scripts/update.py` then `python -m http.server 8765` and open http://localhost:8765.

Forecasts are model output, not financial advice.
