import joblib, json, numpy as np, pandas as pd
P='/home/claude/proj/'
M=joblib.load(P+'artifacts/models.joblib'); E=M['ens_models']; FEAT=M['features']
def r(a,n=6): return [float(f"{v:.{n}g}") for v in np.asarray(a).ravel()]
def tree(t):
    T=t.tree_; leaf=T.children_left==-1
    return {"f":T.feature.tolist(),"t":[float(v) for v in np.where(leaf,0,T.threshold)],"l":T.children_left.tolist(),"r":T.children_right.tolist(),"v":r(T.value[:,0,0],9)}
lr=E['Linear Regression']; sc,lin=lr[0],lr[-1]
gb=E['Gradient Boosting']
model={"features":FEAT,
 "lr":{"mean":r(sc.mean_,12),"scale":r(sc.scale_,12),"coef":r(lin.coef_,12),"intercept":float(lin.intercept_)},
 "rf":[tree(t) for t in E['Random Forest'].estimators_],
 "gb":{"init":float(gb.init_.constant_[0][0]),"lr":gb.learning_rate,"trees":[tree(t) for t in gb.estimators_[:,0]]},
 "cluster":{"cl_poll":M['cl_poll'],"cl_feats":M['cl_feats'],"mean":r(M['scaler_cl'].mean_,12),"scale":r(M['scaler_cl'].scale_,12),
   "pca_mean":r(M['pca'].mean_,12),"components":[r(c,12) for c in M['pca'].components_],"centroids":[r(c,12) for c in M['kmeans'].cluster_centers_],
   "names":{str(k):v for k,v in M['names'].items()}},
 "train_end":M['train_end'],"test_start":M['test_start'],
 "diwali":["2015-11-11","2016-10-30","2017-10-19","2018-11-07","2019-10-27"]}
json.dump(model,open('/home/claude/web/data/model.json','w'),separators=(',',':'))
# daily series (forward-filled inputs + raw AQI)
d=pd.read_csv(P+'artifacts/delhi_daily.csv',index_col=0,parse_dates=True)
P11=["PM2.5","PM10","NO","NO2","NOx","NH3","CO","SO2","O3","Benzene","Toluene"]
ff=d[P11+["AQI"]].ffill()
assert (pd.date_range(d.index.min(),d.index.max())==d.index).all()
days={"start":str(d.index.min().date()),"n":len(d),"cols":P11+["AQI"],
 "ff":{c:[None if pd.isna(v) else round(float(v),3) for v in ff[c]] for c in P11+["AQI"]},
 "aqi_raw":[None if pd.isna(v) else float(v) for v in d.AQI],
 "train_median":{c:round(float(d.loc[:M['train_end'],c].median()),2) for c in P11}}
json.dump(days,open('/home/claude/web/data/days.json','w'),separators=(',',':'))
# meta for performance / day-types tabs
res=pd.read_csv(P+'artifacts/results.csv'); tp=pd.read_csv(P+'artifacts/test_predictions.csv')
prof=pd.read_csv(P+'artifacts/daytype_profiles.csv',index_col=0); cl=pd.read_csv(P+'artifacts/cluster_comparison.csv')
imp=pd.read_csv(P+'artifacts/permutation_importance.csv',index_col=0).iloc[:,0]
share=json.load(open('/tmp/deckdata.json'))
meta={"selected":M['selected'],"type_order":M['type_order'],"type_col":M['type_col'],
 "results":json.loads(res.round(4).to_json(orient='records')),
 "test":{"dates":tp.date_forecast.tolist(),"actual":tp.actual.round(1).tolist(),"selected":tp.selected.round(1).tolist(),"persistence":tp.persistence.round(1).tolist(),"type":tp.day_type_today.tolist()},
 "profiles":json.loads(prof.round(3).rename_axis('type').reset_index().to_json(orient='records')),
 "clusters":json.loads(cl.round(4).to_json(orient='records')),
 "importance":{k:round(float(v),3) for k,v in imp.head(12).items()},
 "month_share":share['share']}
json.dump(meta,open('/home/claude/web/data/meta.json','w'),separators=(',',':'))
import os
for f in ['model','days','meta']: print(f, os.path.getsize(f'/home/claude/web/data/{f}.json')//1024,'KB')
