package com.xander.passotp;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.text.InputType;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;

public class MainActivity extends Activity {
    static final int PICK_IMPORT = 10, CREATE_EXPORT = 11, ITERATIONS = 210000;
    final Handler handler = new Handler(Looper.getMainLooper());
    final ArrayList<Entry> entries = new ArrayList<>();
    final ArrayList<TextView> otpViews = new ArrayList<>();
    SharedPreferences prefs; LinearLayout root, list; EditText unlockInput; SecretKey key; byte[] salt;
    boolean otpOnly = true;

    static class Entry {
        String id="", name="", url="", username="", password="", notes="", otp="", algorithm="SHA1"; int digits=6, period=30;
        JSONObject json() throws JSONException { JSONObject o=new JSONObject(); o.put("id",id); o.put("name",name); o.put("url",url); o.put("username",username); o.put("password",password); o.put("notes",notes); o.put("otp",otp); o.put("algorithm",algorithm); o.put("digits",digits); o.put("period",period); return o; }
        static Entry from(JSONObject o) { Entry e=new Entry(); e.id=o.optString("id",UUID.randomUUID().toString()); e.name=o.optString("name"); e.url=o.optString("url"); e.username=o.optString("username"); e.password=o.optString("password"); e.notes=o.optString("notes"); e.otp=o.optString("otp"); e.algorithm=o.optString("algorithm","SHA1"); e.digits=o.optInt("digits",6); e.period=o.optInt("period",30); return e; }
    }

    @Override public void onCreate(Bundle b) { super.onCreate(b); prefs=getSharedPreferences("passotp",MODE_PRIVATE); showUnlock(); }
    TextView text(String value, float size) { TextView v=new TextView(this); v.setText(value); v.setTextSize(size); v.setTextColor(Color.rgb(24,34,48)); v.setPadding(0,6,0,6); return v; }
    Button button(String value) { Button b=new Button(this); b.setText(value); b.setAllCaps(false); return b; }
    EditText input(String hint, boolean secret) { EditText e=new EditText(this); e.setHint(hint); e.setSingleLine(false); e.setPadding(12,8,12,8); if(secret) e.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD); return e; }
    void base() { root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(20,18,20,12); root.setBackgroundColor(Color.rgb(246,248,251)); setContentView(root); }

    void showUnlock() {
        base(); root.addView(text("PassOTP",26)); root.addView(text("本地密码 OTP 保险库",14));
        unlockInput=input("主密码",true); root.addView(unlockInput,new LinearLayout.LayoutParams(-1,58));
        Button unlock=button("解锁"); root.addView(unlock); TextView error=text("",12); error.setTextColor(Color.rgb(198,40,40)); root.addView(error);
        unlock.setOnClickListener(v->{ try { unlock(unlockInput.getText().toString()); } catch(Exception e){ error.setText("主密码不正确或保险库损坏"); } });
        unlockInput.setOnEditorActionListener((v,a,event)->{unlock.performClick();return true;});
    }

    void unlock(String password) throws Exception {
        if(password.length()<8) throw new Exception("short");
        String savedSalt=prefs.getString("salt",null), savedVault=prefs.getString("vault",null);
        salt=savedSalt==null?random(16):b64d(savedSalt); key=derive(password,salt);
        entries.clear(); if(savedVault!=null) { JSONArray array=new JSONArray(new String(decrypt(new JSONObject(savedVault),key),StandardCharsets.UTF_8)); for(int i=0;i<array.length();i++) entries.add(Entry.from(array.getJSONObject(i))); }
        if(savedSalt==null) saveVault(); showHome();
    }

    void showHome() {
        base(); LinearLayout header=new LinearLayout(this); header.setGravity(Gravity.CENTER_VERTICAL); TextView title=text("PassOTP",22); header.addView(title,new LinearLayout.LayoutParams(0,-2,1)); Button lock=button("锁定"); header.addView(lock); root.addView(header);
        LinearLayout tools=new LinearLayout(this); tools.setGravity(Gravity.CENTER_VERTICAL); CheckBox filter=new CheckBox(this); filter.setText("仅显示 OTP"); filter.setChecked(otpOnly); tools.addView(filter,new LinearLayout.LayoutParams(0,-2,1)); Button add=button("新增"); tools.addView(add); Button settings=button("导入/导出"); tools.addView(settings); root.addView(tools);
        filter.setOnCheckedChangeListener((b,c)->{otpOnly=c; renderList();}); add.setOnClickListener(v->edit(null)); settings.setOnClickListener(v->showDataMenu()); lock.setOnClickListener(v->{key=null;entries.clear();showUnlock();});
        ScrollView scroll=new ScrollView(this); list=new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL); scroll.addView(list); root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1)); renderList();
        handler.removeCallbacksAndMessages(null); handler.postDelayed(new Runnable(){public void run(){updateOtpViews();handler.postDelayed(this,1000);}},500);
    }

    void renderList() {
        if(list==null)return; list.removeAllViews(); otpViews.clear();
        for(Entry e:entries) { if(otpOnly && e.otp.isEmpty()) continue; LinearLayout card=new LinearLayout(this); card.setOrientation(LinearLayout.VERTICAL); card.setPadding(12,8,12,8); card.setBackgroundColor(Color.WHITE);
            LinearLayout top=new LinearLayout(this); TextView name=text(e.name.isEmpty()?"未命名":e.name,15); name.setTypeface(null,1); top.addView(name,new LinearLayout.LayoutParams(0,-2,1)); TextView code=text(e.otp.isEmpty()?"":"------",18); code.setTextColor(Color.rgb(23,105,170)); top.addView(code); card.addView(top); otpViews.add(code);
            TextView user=text(e.username,13); card.addView(user); LinearLayout actions=new LinearLayout(this); Button copyUser=button("复制账号"), copyPass=button("复制密码"), copyOtp=button("复制 OTP"), edit=button("编辑"); actions.addView(copyUser); actions.addView(copyPass); if(!e.otp.isEmpty())actions.addView(copyOtp); actions.addView(edit); card.addView(actions); list.addView(card,new LinearLayout.LayoutParams(-1,-2));
            copyUser.setOnClickListener(v->copy(e.username)); copyPass.setOnClickListener(v->copy(e.password)); copyOtp.setOnClickListener(v->{try{copy(totp(e));}catch(Exception ignored){}}); edit.setOnClickListener(v->edit(e));
            View divider=new View(this); divider.setBackgroundColor(Color.rgb(220,225,232)); list.addView(divider,new LinearLayout.LayoutParams(-1,1));
        }
        if(list.getChildCount()==0) list.addView(text(otpOnly?"暂无 OTP 项目":"暂无数据",14)); updateOtpViews();
    }
    void updateOtpViews(){int i=0; for(Entry e:entries){if(otpOnly&&e.otp.isEmpty())continue; if(i>=otpViews.size())break; try{otpViews.get(i++).setText(e.otp.isEmpty()?"":totp(e));}catch(Exception ignored){}}}
    void copy(String value){((android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("PassOTP",value==null?"":value)); Toast.makeText(this,"已复制",Toast.LENGTH_SHORT).show();}

    void edit(Entry existing) {
        LinearLayout form=new LinearLayout(this); form.setPadding(12,0,12,0); form.setOrientation(LinearLayout.VERTICAL); ScrollView scroll=new ScrollView(this); scroll.addView(form);
        EditText name=input("名称",false), url=input("网站地址（可选）",false), user=input("账号",false), pass=input("密码",true), otp=input("OTP 密钥（可选）",false), notes=input("备注（可选）",false); form.addView(name);form.addView(url);form.addView(user);form.addView(pass);form.addView(otp);form.addView(notes);
        if(existing!=null){name.setText(existing.name);url.setText(existing.url);user.setText(existing.username);pass.setText(existing.password);otp.setText(existing.otp);notes.setText(existing.notes);}
        final Entry[] target={existing};
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle(existing==null?"新增项目":"编辑项目").setView(scroll).setNegativeButton("取消",null).setPositiveButton("保存",null).create();
        dialog.setOnShowListener(x->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{String secret=normalizeOtp(otp.getText().toString()); if(target[0]==null){target[0]=new Entry();target[0].id=UUID.randomUUID().toString();entries.add(0,target[0]);} target[0].name=name.getText().toString().trim();target[0].url=url.getText().toString().trim();target[0].username=user.getText().toString();target[0].password=pass.getText().toString();target[0].otp=secret;target[0].notes=notes.getText().toString();try{saveVault();dialog.dismiss();renderList();}catch(Exception e){Toast.makeText(this,"保存失败",Toast.LENGTH_SHORT).show();}})); dialog.show();
    }

    void showDataMenu(){new AlertDialog.Builder(this).setTitle("数据").setItems(new String[]{"导入加密保险库","导出加密保险库"},(d,which)->{if(which==0)startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE),PICK_IMPORT);else startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json").putExtra(Intent.EXTRA_TITLE,"passotp-vault.json"),CREATE_EXPORT);}).show();}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(result!=RESULT_OK||data==null)return;try{if(request==PICK_IMPORT){String raw=read(data.getData());JSONObject pkg=new JSONObject(raw);if(!"local-password-otp-vault".equals(pkg.optString("format")))throw new Exception();prefs.edit().putString("salt",pkg.getString("salt")).putString("vault",pkg.getJSONObject("vault").toString()).apply();key=null;showUnlock();Toast.makeText(this,"导入成功，请使用导出时的主密码解锁",Toast.LENGTH_LONG).show();}else{write(data.getData(),exportPackage().toString());Toast.makeText(this,"导出成功",Toast.LENGTH_SHORT).show();}}catch(Exception e){Toast.makeText(this,"文件无效或读写失败",Toast.LENGTH_LONG).show();}}
    JSONObject exportPackage() throws Exception{JSONObject p=new JSONObject();p.put("format","local-password-otp-vault");p.put("version",1);p.put("exportedAt",new Date().toString());p.put("salt",b64(salt));p.put("vault",new JSONObject(prefs.getString("vault","{}")));return p;}
    String read(Uri u)throws Exception{StringBuilder s=new StringBuilder();try(BufferedReader r=new BufferedReader(new InputStreamReader(getContentResolver().openInputStream(u),StandardCharsets.UTF_8))){String l;while((l=r.readLine())!=null)s.append(l);}return s.toString();}
    void write(Uri u,String value)throws Exception{try(OutputStream o=getContentResolver().openOutputStream(u)){o.write(value.getBytes(StandardCharsets.UTF_8));}}

    void saveVault() throws Exception{JSONArray a=new JSONArray();for(Entry e:entries)a.put(e.json());byte[] iv=random(12), data=encrypt(a.toString().getBytes(StandardCharsets.UTF_8),key,iv);JSONObject record=new JSONObject();record.put("iv",b64(iv));record.put("data",b64(data));prefs.edit().putString("salt",b64(salt)).putString("vault",record.toString()).apply();}
    static SecretKey derive(String password,byte[] salt)throws Exception{PBEKeySpec spec=new PBEKeySpec(password.toCharArray(),salt,ITERATIONS,256);byte[] raw=SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();return new SecretKeySpec(raw,"AES");}
    static byte[] encrypt(byte[] data,SecretKey key,byte[] iv)throws Exception{Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key,new GCMParameterSpec(128,iv));return c.doFinal(data);}
    static byte[] decrypt(JSONObject record,SecretKey key)throws Exception{return decrypt(b64d(record.getString("data")),key,b64d(record.getString("iv")));}
    static byte[] decrypt(byte[] data,SecretKey key,byte[] iv)throws Exception{Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,iv));return c.doFinal(data);}
    static byte[] random(int n){byte[] b=new byte[n];new SecureRandom().nextBytes(b);return b;} static String b64(byte[] b){return Base64.getEncoder().encodeToString(b);} static byte[] b64d(String s){return Base64.getDecoder().decode(s);}
    String normalizeOtp(String raw){raw=raw.trim();if(!raw.toLowerCase().startsWith("otpauth://"))return raw.replace(" ","").toUpperCase(Locale.ROOT);try{String q=raw.substring(raw.indexOf('?')+1);for(String p:q.split("&")){String[] kv=p.split("=",2);if(kv.length==2&&kv[0].equalsIgnoreCase("secret"))return java.net.URLDecoder.decode(kv[1],"UTF-8").replace(" ","").toUpperCase(Locale.ROOT);}}catch(Exception ignored){}return raw;}
    String totp(Entry e)throws Exception{byte[] secret=base32(e.otp);long counter=(System.currentTimeMillis()/1000)/(e.period>0?e.period:30);byte[] msg=new byte[8];for(int i=7;i>=0;i--){msg[i]=(byte)(counter&255);counter>>>=8;}Mac mac=Mac.getInstance(e.algorithm.equalsIgnoreCase("SHA256")?"HmacSHA256":e.algorithm.equalsIgnoreCase("SHA512")?"HmacSHA512":"HmacSHA1");mac.init(new SecretKeySpec(secret,mac.getAlgorithm()));byte[] hash=mac.doFinal(msg);int off=hash[hash.length-1]&15;long code=((hash[off]&127L)<<24)|((hash[off+1]&255L)<<16)|((hash[off+2]&255L)<<8)|(hash[off+3]&255L);long mod=(long)Math.pow(10,e.digits>0?e.digits:6);return String.format(Locale.US,"%0"+(e.digits>0?e.digits:6)+"d",code%mod);}
    byte[] base32(String value){String s=value.replace("=","").replace(" ","").toUpperCase(Locale.ROOT);ByteArrayOutputStream out=new ByteArrayOutputStream();int buffer=0,bits=0;for(char ch:s.toCharArray()){int v="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(ch);if(v<0)continue;buffer=(buffer<<5)|v;bits+=5;if(bits>=8){bits-=8;out.write((buffer>>bits)&255);}}return out.toByteArray();}
}
