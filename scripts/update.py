"""Builds data/forecast.json for the Vol radar app: today's 5-day volatility forecast for every market,
plus ~90 days of forecast-vs-actual history for the charts. Runs daily in GitHub Actions.

Usage: python scripts/update.py
Needs: numpy pandas yfinance onnxruntime
"""
import json, sys
from datetime import datetime, timezone
from pathlib import Path
import numpy as np, pandas as pd, yfinance as yf, onnxruntime as ort

ROOT = Path(__file__).resolve().parent.parent
cfg = json.loads((ROOT / "model" / "vol_config.json").read_text())
MARKETS, FEATS, SEQ, HZ, EPS = cfg["markets"], cfg["features"], cfg["seq"], cfg["hz"], cfg["eps"]
MU, SD = pd.Series(cfg["mu"], index=FEATS), pd.Series(cfg["sd"], index=FEATS)
COEF = np.array(cfg["linear_coef"])
HIST = 90

# display name, category, typical MT5/CFD symbol ("" when there's no common CFD)
META = {
    "SPY": ("S&P 500 ETF", "Stocks", "US500"), "QQQ": ("Nasdaq 100 ETF", "Stocks", "US100"),
    "IWM": ("Russell 2000 ETF", "Stocks", "US2000"), "DIA": ("Dow Jones ETF", "Stocks", "US30"),
    "EFA": ("Developed markets ETF", "Stocks", ""), "EEM": ("Emerging markets ETF", "Stocks", ""),
    "EWJ": ("Japan ETF", "Stocks", "JP225"), "XLE": ("US energy stocks", "Stocks", ""),
    "XLF": ("US financial stocks", "Stocks", ""), "XLK": ("US tech stocks", "Stocks", ""),
    "XLU": ("US utilities", "Stocks", ""), "VNQ": ("US real estate", "Stocks", ""),
    "^GSPC": ("S&P 500", "Stocks", "US500"), "^IXIC": ("Nasdaq", "Stocks", "US100"),
    "^RUT": ("Russell 2000", "Stocks", "US2000"), "^N225": ("Nikkei 225", "Stocks", "JP225"),
    "^FTSE": ("FTSE 100", "Stocks", "UK100"), "^GDAXI": ("DAX", "Stocks", "DE40"), "^HSI": ("Hang Seng", "Stocks", "HK50"),
    "TLT": ("US 20y+ bonds", "Bonds", ""), "IEF": ("US 7-10y bonds", "Bonds", ""), "LQD": ("Corporate bonds", "Bonds", ""),
    "HYG": ("High-yield bonds", "Bonds", ""), "ZN=F": ("US 10y note", "Bonds", ""), "ZB=F": ("US 30y bond", "Bonds", ""),
    "EURUSD=X": ("EUR/USD", "FX", "EURUSD"), "GBPUSD=X": ("GBP/USD", "FX", "GBPUSD"),
    "USDJPY=X": ("USD/JPY", "FX", "USDJPY"), "AUDUSD=X": ("AUD/USD", "FX", "AUDUSD"),
    "GLD": ("Gold ETF", "Metals", "XAUUSD"), "GC=F": ("Gold", "Metals", "XAUUSD"), "SLV": ("Silver ETF", "Metals", "XAGUSD"),
    "SI=F": ("Silver", "Metals", "XAGUSD"), "HG=F": ("Copper", "Metals", "COPPER"),
    "USO": ("Oil ETF", "Energy", "USOIL"), "CL=F": ("Crude oil", "Energy", "USOIL"), "NG=F": ("Natural gas", "Energy", "NGAS"),
    "DBC": ("Commodities ETF", "Energy", ""), "BTC-USD": ("Bitcoin", "Crypto", "BTCUSD"), "ETH-USD": ("Ethereum", "Crypto", "ETHUSD"),
}

def feats(d, vix):
    """identical to feats3 in the Colab notebook"""
    d = d.dropna(); d = d[(d["Low"] > 0) & (d["High"] >= d["Low"])]
    lc = np.log(d["Close"]); r = lc.diff(); r2 = r ** 2
    gk = (0.5 * np.log(d["High"] / d["Low"]) ** 2 - (2 * np.log(2) - 1) * np.log(d["Close"] / d["Open"]) ** 2).clip(lower=0)
    f = pd.DataFrame(index=d.index)
    for w in (1, 5, 22, 66):
        f[f"lrv{w}"] = np.log(r2.rolling(w).mean() + EPS)
        f[f"lgk{w}"] = np.log(gk.rolling(w).mean() + EPS)
    vol22 = np.sqrt(r2.rolling(22).mean())
    f["ret1"], f["ret5"], f["ret22"] = r / vol22, lc.diff(5) / vol22, lc.diff(22) / vol22
    f["down1"] = (r < 0) * f["ret1"].abs()
    v = vix.reindex(d.index).ffill()
    f["vix"], f["dvix5"] = v, v.diff(5)
    f["mom252"] = lc.diff(252)
    f["r2"] = r2
    return f.replace([np.inf, -np.inf], np.nan)

def main():
    start = (pd.Timestamp.today() - pd.Timedelta(days=3 * 365)).strftime("%Y-%m-%d")
    raw = yf.download(MARKETS + ["^VIX"], start=start, interval="1d", auto_adjust=True, progress=False, group_by="ticker")

    def get(tk):
        """bulk download sometimes drops a ticker (Yahoo timeouts / cache lock) -> retry it on its own"""
        d = raw[tk][["Open", "High", "Low", "Close"]] if tk in raw.columns.get_level_values(0) else None
        for _ in range(3):
            if d is not None and d["Close"].notna().sum() > 300: return d
            one = yf.download(tk, start=start, interval="1d", auto_adjust=True, progress=False, multi_level_index=False)
            d = one[["Open", "High", "Low", "Close"]] if len(one) else None
        return d

    vix = np.log(get("^VIX")["Close"].dropna())
    xs, ids, rows = [], [], []          # one row per (market, history day); last row of each market = today
    per = {}
    for a, tk in enumerate(MARKETS):
        d = get(tk)
        if d is None:
            print("no data for", tk, file=sys.stderr); continue
        f = feats(d, vix)
        z = ((f[FEATS] - MU) / SD).clip(-5, 5).values.astype(np.float32)
        ok = ~np.isnan(z).any(axis=1)
        n = len(f); picks = []
        for i in range(max(SEQ - 1, n - HIST), n):
            if ok[i - SEQ + 1:i + 1].all(): picks.append(i)
        if not picks or picks[-1] != n - 1:
            print("not enough clean history for", tk, file=sys.stderr); continue
        r2 = f["r2"].values
        for i in picks:
            xs.append(z[i - SEQ + 1:i + 1]); ids.append(a)
            fut = r2[i + 1:i + 1 + HZ]
            rows.append(dict(tk=tk, i=i, date=f.index[i].strftime("%Y-%m-%d"), z=z[i],
                             actual=float(np.sqrt(fut.mean() * 252) * 100) if len(fut) == HZ and not np.isnan(fut).any() else None))
        per[tk] = f
    sess = ort.InferenceSession(str(ROOT / "model" / "vol_transformer.onnx"))
    x, aa = np.stack(xs), np.array(ids, dtype=np.int64)
    tr = np.concatenate([sess.run(None, {"x": x[b:b + 512], "asset": aa[b:b + 512]})[0] for b in range(0, len(x), 512)])
    nf = len(FEATS)
    lin = np.array([r["z"] @ COEF[:nf] + COEF[nf + a] for r, a in zip(rows, ids)])
    w = np.array([cfg["blend_w"][a] for a in ids])
    fc = np.sqrt(np.exp(w * tr + (1 - w) * lin + cfg["bias"]) * 252) * 100

    out = []
    for tk, f in per.items():
        k = [j for j, r in enumerate(rows) if r["tk"] == tk]
        last = k[-1]; a = MARKETS.index(tk)
        name, cat, sym = META.get(tk, (tk, "Other", ""))
        mom = f["mom252"].iloc[-1]
        out.append(dict(
            ticker=tk, name=name, cat=cat, sym=sym, data_to=rows[last]["date"],
            vol_month=round(float(np.sqrt(np.exp(f["lrv22"].iloc[-1]) * 252) * 100), 2),
            forecast=round(float(fc[last]), 2), ai_weight=cfg["blend_w"][a],
            trend=0 if np.isnan(mom) else int(np.sign(mom)),
            hist=dict(d=[rows[j]["date"] for j in k], f=[round(float(fc[j]), 2) for j in k],
                      a=[None if rows[j]["actual"] is None else round(rows[j]["actual"], 2) for j in k]),
        ))
    doc = dict(generated=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
               trained_through=cfg["trained_through"], horizon_days=HZ, markets=out)
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data" / "forecast.json").write_text(json.dumps(doc, separators=(",", ":")))
    print(f"wrote {len(out)} markets, {len(rows)} forecasts -> data/forecast.json")

if __name__ == "__main__":
    main()
