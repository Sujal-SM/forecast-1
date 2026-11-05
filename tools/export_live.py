import joblib, json, numpy as np, pandas as pd
L=joblib.load('/home/claude/live/live_models.joblib'); M=L['models']
def r(a,n=12): return [float(f"{v:.{n}g}") for v in np.asarray(a).ravel()]
def tree(t):
    T=t.tree_; leaf=T.children_left==-1
    return {"f":T.feature.tolist(),"t":[float(v) for v in np.where(leaf,0,T.threshold)],"l":T.children_left.tolist(),"r":T.children_right.tolist(),"v":r(T.value[:,0,0],9)}
lr=M['Linear Regression']; gb=M['Gradient Boosting']
R=pd.read_csv('/home/claude/live/live_results.csv')
out={"features":L['features'],"selected":L['selected'],
 "lr":{"mean":r(lr[0].mean_),"scale":r(lr[0].scale_),"coef":r(lr[-1].coef_),"intercept":float(lr[-1].intercept_)},
 "rf":[tree(t) for t in M['Random Forest'].estimators_],
 "gb":{"init":float(gb.init_.constant_[0][0]),"lr":gb.learning_rate,"trees":[tree(t) for t in gb.estimators_[:,0]]},
 "diwali":["2015-11-11","2016-10-30","2017-10-19","2018-11-07","2019-10-27","2020-11-14","2021-11-04","2022-10-24","2023-11-12","2024-11-01","2025-10-20","2026-11-08","2027-10-29"],
 "results":json.loads(R.round(4).to_json(orient='records'))}
json.dump(out,open('/home/claude/web/data/live_model.json','w'),separators=(',',':'))
import os; print(os.path.getsize('/home/claude/web/data/live_model.json')//1024,'KB')
# reference for parity: features + ensemble preds on all days using official AQI
exec(open('/home/claude/live/train_live.py').read().split("tr,te=")[0])
X=data[FEAT]; p=np.mean([m.predict(X) for m in M.values()],axis=0)
ser=pd.DataFrame({c:d[c] for c in P6}); ser['AQI']=d['AQI']
json.dump({"dates":[str(x.date()) for x in X.index],"pred":p.tolist(),"X":X.values.tolist(),
  "raw":{"dates":[str(x.date()) for x in ser.index],**{c:[None if pd.isna(v) else float(v) for v in ser[c]] for c in ser.columns}}},open('/tmp/liveref.json','w'))
print(len(X))
