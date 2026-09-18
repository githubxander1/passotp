package com.xander.passotp;

import android.app.assist.AssistStructure;
import android.content.*;
import android.os.CancellationSignal;
import android.os.Bundle;
import android.service.autofill.*;
import android.view.View;
import android.view.autofill.AutofillId;
import android.view.autofill.AutofillValue;
import android.widget.RemoteViews;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;

public class PassOtpAutofillService extends AutofillService {
    static final int ITERATIONS=210000;
    SharedPreferences prefs;
    static class FieldSet { AutofillId user, pass; String username="", password=""; }
    static class Entry { String id,name,username,password; Entry(JSONObject o){id=o.optString("id",UUID.randomUUID().toString());name=o.optString("name","未命名");username=o.optString("username");password=o.optString("password");} }

    @Override public void onCreate(){super.onCreate();prefs=getSharedPreferences("passotp",MODE_PRIVATE);}
    @Override public void onFillRequest(FillRequest request, CancellationSignal cancellationSignal, FillCallback callback){
        try {
            ArrayList<Entry> entries=loadEntries(); if(entries==null||entries.isEmpty()){callback.onSuccess(null);return;}
            AssistStructure structure=request.getFillContexts().get(request.getFillContexts().size()-1).getStructure(); FieldSet fields=findFields(structure.getWindowNodeAt(0).getRootViewNode());
            if(fields.user==null&&fields.pass==null){callback.onSuccess(null);return;}
            FillResponse.Builder response=new FillResponse.Builder();
            for(Entry e:entries){RemoteViews presentation=new RemoteViews(getPackageName(),android.R.layout.simple_list_item_2);presentation.setTextViewText(android.R.id.text1,e.name);presentation.setTextViewText(android.R.id.text2,e.username);Dataset.Builder dataset=new Dataset.Builder(presentation);if(fields.user!=null)dataset.setValue(fields.user,AutofillValue.forText(e.username),presentation);if(fields.pass!=null)dataset.setValue(fields.pass,AutofillValue.forText(e.password),presentation);response.addDataset(dataset.build());}
            if(fields.user!=null||fields.pass!=null){ArrayList<AutofillId> idList=new ArrayList<>();if(fields.user!=null)idList.add(fields.user);if(fields.pass!=null)idList.add(fields.pass);response.setSaveInfo(new SaveInfo.Builder(SaveInfo.SAVE_DATA_TYPE_USERNAME|SaveInfo.SAVE_DATA_TYPE_PASSWORD,idList.toArray(new AutofillId[0])).build());}
            callback.onSuccess(response.build());
        }catch(Exception e){callback.onFailure("PassOTP 暂时无法读取登录表单");}
    }
    @Override public void onSaveRequest(SaveRequest request, SaveCallback callback){try{AssistStructure s=request.getFillContexts().get(request.getFillContexts().size()-1).getStructure();FieldSet f=findFields(s.getWindowNodeAt(0).getRootViewNode());if(f.username.isEmpty()||f.password.isEmpty()){callback.onSuccess();return;}ArrayList<Entry> list=loadEntries();if(list==null)list=new ArrayList<>();Entry match=null;for(Entry e:list)if(e.username.equals(f.username)){match=e;break;}if(match==null){match=new Entry(new JSONObject());match.id=UUID.randomUUID().toString();match.name="Android 登录";list.add(0,match);}match.username=f.username;match.password=f.password;saveEntries(list);callback.onSuccess();}catch(Exception e){callback.onFailure("保存登录信息失败");}}
    FieldSet findFields(AssistStructure.ViewNode node){FieldSet out=new FieldSet();walk(node,out);return out;}
    void walk(AssistStructure.ViewNode node,FieldSet out){if(node==null)return;String[] hints=node.getAutofillHints();String meta=((node.getHint()==null?"":node.getHint())+" "+(node.getIdEntry()==null?"":node.getIdEntry())).toLowerCase(Locale.ROOT);boolean password=(node.getInputType()&android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD)!=0||(node.getInputType()&android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD)!=0;boolean user=meta.contains("user")||meta.contains("login")||meta.contains("account")||meta.contains("email")||meta.contains("邮箱")||meta.contains("账号");if(hints!=null)for(String h:hints)if(h!=null&&(h.contains("username")||h.contains("email")))user=true;if(!password&&hints!=null)for(String h:hints)if(h!=null&&h.contains("password"))password=true;if(user&&out.user==null)out.user=node.getAutofillId();if(password&&out.pass==null)out.pass=node.getAutofillId();if(node.getAutofillValue()!=null&&node.getAutofillValue().isText()){if(user)out.username=node.getAutofillValue().getTextValue().toString();if(password)out.password=node.getAutofillValue().getTextValue().toString();}for(int i=0;i<node.getChildCount();i++)walk(node.getChildAt(i),out);}
    ArrayList<Entry> loadEntries()throws Exception{String raw=prefs.getString("session_key",null);long until=prefs.getLong("session_until",0);if(raw==null||until<System.currentTimeMillis())return null;SecretKey key=new SecretKeySpec(Base64.getDecoder().decode(raw),"AES");String vault=prefs.getString("vault",null);if(vault==null)return new ArrayList<>();JSONObject record=new JSONObject(vault);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,Base64.getDecoder().decode(record.getString("iv"))));JSONArray array=new JSONArray(new String(c.doFinal(Base64.getDecoder().decode(record.getString("data"))),StandardCharsets.UTF_8));ArrayList<Entry> list=new ArrayList<>();for(int i=0;i<array.length();i++)list.add(new Entry(array.getJSONObject(i)));return list;}
    void saveEntries(ArrayList<Entry> list)throws Exception{String raw=prefs.getString("session_key",null);SecretKey key=new SecretKeySpec(Base64.getDecoder().decode(raw),"AES");JSONArray array=new JSONArray();for(Entry e:list){JSONObject o=new JSONObject();o.put("id",e.id);o.put("name",e.name);o.put("url","");o.put("username",e.username);o.put("password",e.password);o.put("notes","");o.put("otp","");o.put("algorithm","SHA1");o.put("digits",6);o.put("period",30);array.put(o);}byte[] iv=new byte[12];new SecureRandom().nextBytes(iv);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key,new GCMParameterSpec(128,iv));JSONObject record=new JSONObject();record.put("iv",Base64.getEncoder().encodeToString(iv));record.put("data",Base64.getEncoder().encodeToString(c.doFinal(array.toString().getBytes(StandardCharsets.UTF_8))));prefs.edit().putString("vault",record.toString()).apply();}
}
