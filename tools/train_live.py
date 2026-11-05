import pandas as pd, numpy as np, json, sys, time, joblib, warnings; warnings.filterwarnings('ignore')
sys.path.insert(0,'/home/claude/live'); from cpcb_aqi import aqi_row
from sklearn.linear_model import LinearRegression
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_error as MAE, mean_squared_error, r2_score
SEED=21; P6=["PM2.5","PM10","NO2","SO2","CO","O3"]
DIWALI=pd.to_datetime(["2015-11-11","2016-10-30","2017-10-19","2018-11-07","2019-10-27","2020-11-14","2021-11-04","2022-10-24","2023-11-12","2024-11-01","2025-10-20","2026-11-08","2027-10-29"])
d=pd.read_csv('/home/claude/proj/data/city_day.csv',parse_dates=['Date']); d=d[d.City=='Delhi'].set_index('Date').sort_index()
d['AQI6']=d.apply(aqi_row,axis=1)
d['AQI6']=d['AQI']  # official dataset AQI as target and history
ff=d[P6+['AQI6']].ffill()
f=pd.DataFrame(index=d.index)
for c in P6: f[c]=ff[c]
f['PM_ratio']=ff['PM2.5']/ff['PM10']
for l in [0,1,2,6]: f[f'AQI_lag{l}']=ff.AQI6.shift(l)
for w in [3,7,14]: f[f'AQI_roll{w}']=ff.AQI6.rolling(w).mean()
f['AQI_std7']=ff.AQI6.rolling(7).std(); f['AQI_diff1']=ff.AQI6.diff(); f['PM25_roll3']=ff['PM2.5'].rolling(3).mean()
tom=d.index+pd.Timedelta(days=1)
f['doy_sin']=np.sin(2*np.pi*tom.dayofyear/365.25); f['doy_cos']=np.cos(2*np.pi*tom.dayofyear/365.25); f['dow']=tom.dayofweek
f['diwali_window']=[int(any(abs((t-x).days)<=2 for x in DIWALI)) for t in tom]
f['target']=d.AQI6.shift(-1)
data=f.dropna(); FEAT=[c for c in data.columns if c!='target']
tr,te=data[:'2019-06-30'],data['2019-07-01':]
Xtr,ytr,Xte,yte=tr[FEAT],tr.target,te[FEAT],te.target
MK={'Linear Regression':lambda:make_pipeline(StandardScaler(),LinearRegression()),
    'Random Forest':lambda:RandomForestRegressor(250,max_features=0.6,min_samples_leaf=3,random_state=SEED,n_jobs=-1),
    'Gradient Boosting':lambda:GradientBoostingRegressor(n_estimators=500,learning_rate=0.03,max_depth=3,subsample=0.8,random_state=SEED)}
tscv=TimeSeriesSplit(5,test_size=120)
def run(name,Xa,ya,Xb):
    if name=='Persistence': return Xb.AQI_lag0.values
    if name=='Ensemble': return np.mean([MK[m]().fit(Xa,ya).predict(Xb) for m in MK],axis=0)
    return MK[name]().fit(Xa,ya).predict(Xb)
rows=[]
for n in ['Persistence','Linear Regression','Random Forest','Gradient Boosting','Ensemble']:
    cv=np.mean([MAE(ytr.iloc[b],run(n,Xtr.iloc[a],ytr.iloc[a],Xtr.iloc[b])) for a,b in tscv.split(Xtr)])
    p=run(n,Xtr,ytr,Xte); rows.append(dict(model=n,cv_mae=cv,mae=MAE(yte,p),rmse=mean_squared_error(yte,p)**.5,r2=r2_score(yte,p)))
R=pd.DataFrame(rows); pm=R.loc[R.model=='Persistence','mae'].item(); R['skill_%']=100*(1-R.mae/pm)
print(len(tr),len(te)); print(R.round(3).to_string(index=False))
sel=R[R.model!='Persistence'].sort_values('cv_mae').model.iloc[0]; print('selected by CV:',sel)
models={m:MK[m]().fit(Xtr,ytr) for m in MK}
joblib.dump({'models':models,'features':FEAT,'selected':sel},'/home/claude/live/live_models.joblib')
R.to_csv('/home/claude/live/live_results.csv',index=False)
# category hit
pens=np.mean([m.predict(Xte) for m in models.values()],axis=0)
cat=lambda v: np.digitize(v,[50,100,200,300,400])
print('category hit ens', round((cat(pens)==cat(yte.values)).mean()*100,1), 'persist', round((cat(Xte.AQI_lag0.values)==cat(yte.values)).mean()*100,1))
json.dump({'feat':FEAT},open('/tmp/livefeat.json','w'))
