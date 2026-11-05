import numpy as np, pandas as pd
# CPCB National AQI breakpoints (concentration ranges per category), with the common open-ended top extension
BP = {  # pollutant: [(c_lo, c_hi, i_lo, i_hi), ...]
 "PM10":  [(0,50,0,50),(50,100,50,100),(100,250,100,200),(250,350,200,300),(350,430,300,400),(430,510,400,500)],
 "PM2.5": [(0,30,0,50),(30,60,50,100),(60,90,100,200),(90,120,200,300),(120,250,300,400),(250,380,400,500)],
 "NO2":   [(0,40,0,50),(40,80,50,100),(80,180,100,200),(180,280,200,300),(280,400,300,400),(400,520,400,500)],
 "O3":    [(0,50,0,50),(50,100,50,100),(100,168,100,200),(168,208,200,300),(208,748,300,400),(748,868,400,500)],
 "CO":    [(0,1,0,50),(1,2,50,100),(2,10,100,200),(10,17,200,300),(17,34,300,400),(34,51,400,500)],
 "SO2":   [(0,40,0,50),(40,80,50,100),(80,380,100,200),(380,800,200,300),(800,1600,300,400),(1600,2400,400,500)],
}
def sub_index(p, c):
    if c is None or np.isnan(c) or c < 0: return np.nan
    for lo, hi, ilo, ihi in BP[p]:
        if c <= hi: return ilo + (c - lo) * (ihi - ilo) / (hi - lo)
    return 500.0
def aqi_row(r):
    subs = {p: sub_index(p, r[p]) for p in BP}
    valid = {p: v for p, v in subs.items() if not np.isnan(v)}
    if len(valid) < 3 or not ({"PM2.5", "PM10"} & set(valid)): return np.nan
    return min(500.0, max(valid.values()))
