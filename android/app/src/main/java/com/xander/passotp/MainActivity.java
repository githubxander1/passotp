package com.xander.passotp;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
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
    int dp(float value){return (int)(value*getResources().getDisplayMetrics().density+0.5f);}
    TextView text(String value, float size) { TextView v=new TextView(this); v.setText(value); v.setTextSize(size); v.setTextColor(Color.rgb(24,34,48)); v.setPadding(0,dp(5),0,dp(5)); return v; }
    GradientDrawable shape(int color,int radius,int stroke){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(radius);if(stroke>0)d.setStroke(1,stroke);return d;}
    Button button(String value) { Button b=new Button(this); b.setText(value); b.setAllCaps(false); b.setTextSize(12); b.setTextColor(Color.WHITE); b.setMinHeight(dp(44)); b.setPadding(dp(12),0,dp(12),0); b.setBackground(shape(Color.rgb(36,99,235),dp(12),0)); return b; }
    Button softButton(String value) { Button b=button(value); b.setTextColor(Color.rgb(51,65,85)); b.setBackground(shape(Color.rgb(231,235,242),dp(12),0)); return b; }
    Button dangerButton(String value) { Button b=button(value); b.setBackground(shape(Color.rgb(211,63,63),dp(12),0)); return b; }
    EditText input(String hint, boolean secret) { EditText e=new EditText(this); e.setHint(hint); e.setTextSize(14); e.setSingleLine(false); e.setPadding(dp(14),dp(8),dp(14),dp(8)); e.setBackground(shape(Color.WHITE,dp(12),Color.rgb(203,211,223))); if(secret) e.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD); return e; }
    void base() { root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(dp(20),dp(18),dp(20),dp(14)); root.setBackgroundColor(Color.rgb(247,248,252)); setContentView(root); }
    void addField(LinearLayout form,String label,EditText field){TextView caption=text(label,12);caption.setTextColor(Color.rgb(104,115,133));form.addView(caption);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,dp(48));p.bottomMargin=dp(10);form.addView(field,p);}
    void sizeDialog(Dialog dialog){Window w=dialog.getWindow();if(w!=null){w.setBackgroundDrawable(shape(Color.WHITE,dp(20),0));w.setDimAmount(.35f);w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);int width=Math.min((int)(getResources().getDisplayMetrics().widthPixels*.92f),dp(430));w.setLayout(width,WindowManager.LayoutParams.WRAP_CONTENT);}}

    void showUnlock() {
        base(); TextView title=text("PassOTP",30); title.setTypeface(null,1); root.addView(title); TextView subtitle=text("本地密码 OTP 保险库",14); subtitle.setTextColor(Color.rgb(104,115,133)); root.addView(subtitle);
        unlockInput=input("主密码",true); LinearLayout.LayoutParams inputParams=new LinearLayout.LayoutParams(-1,dp(54));inputParams.topMargin=dp(22);root.addView(unlockInput,inputParams);
        Button unlock=button("解锁"); LinearLayout.LayoutParams unlockParams=new LinearLayout.LayoutParams(-1,dp(50));unlockParams.topMargin=dp(12);root.addView(unlock,unlockParams); TextView error=text("",12); error.setTextColor(Color.rgb(198,40,40)); root.addView(error);
        BiometricManager biometricManager=Build.VERSION.SDK_INT>=29?(BiometricManager)getSystemService(BIOMETRIC_SERVICE):null;
        Button biometric=softButton("使用生物识别解锁");LinearLayout.LayoutParams biometricParams=new LinearLayout.LayoutParams(-1,dp(48));biometricParams.topMargin=dp(8);root.addView(biometric,biometricParams); biometric.setOnClickListener(v->{if(biometricManager==null){error.setText("当前 Android 版本不支持生物识别");return;}if(prefs.getString("session_key",null)==null){error.setText("请先使用主密码解锁一次");return;}if(prefs.getLong("session_until",0)<=System.currentTimeMillis()){error.setText("会话已过期，请先使用主密码解锁");return;}if(biometricManager.canAuthenticate()!=BiometricManager.BIOMETRIC_SUCCESS){error.setText("请先在系统设置中录入指纹或面容");return;}biometricUnlock(error);});
        unlock.setOnClickListener(v->{ try { unlock(unlockInput.getText().toString()); } catch(Exception e){ error.setText("主密码不正确或保险库损坏"); } });
        unlockInput.setOnEditorActionListener((v,a,event)->{unlock.performClick();return true;});
    }

    void biometricUnlock(TextView error){
        if(Build.VERSION.SDK_INT<28)return;
        BiometricPrompt prompt=new BiometricPrompt.Builder(this).setTitle("解锁 PassOTP").setSubtitle("使用设备生物识别解锁本次会话").setNegativeButton("使用主密码",getMainExecutor(),(d,w)->{}).build();
        prompt.authenticate(new CancellationSignal(),getMainExecutor(),new BiometricPrompt.AuthenticationCallback(){@Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result){try{unlockFromSession();}catch(Exception e){error.setText("会话密钥已失效，请使用主密码");}}@Override public void onAuthenticationError(int code,CharSequence message){error.setText(message);}});
    }
    void unlockFromSession() throws Exception {String raw=prefs.getString("session_key",null);if(raw==null||prefs.getLong("session_until",0)<System.currentTimeMillis())throw new Exception();key=new SecretKeySpec(b64d(raw),"AES");salt=b64d(prefs.getString("salt",""));entries.clear();String savedVault=prefs.getString("vault",null);if(savedVault!=null){JSONArray array=new JSONArray(new String(decrypt(new JSONObject(savedVault),key),StandardCharsets.UTF_8));for(int i=0;i<array.length();i++)entries.add(Entry.from(array.getJSONObject(i)));}showHome();}

    void unlock(String password) throws Exception {
        if(password.length()<8) throw new Exception("short");
        String savedSalt=prefs.getString("salt",null), savedVault=prefs.getString("vault",null);
        salt=savedSalt==null?random(16):b64d(savedSalt); key=derive(password,salt);
        entries.clear(); if(savedVault!=null) { JSONArray array=new JSONArray(new String(decrypt(new JSONObject(savedVault),key),StandardCharsets.UTF_8)); for(int i=0;i<array.length();i++) entries.add(Entry.from(array.getJSONObject(i))); }
        if(savedSalt==null) saveVault();
        prefs.edit().putString("session_key",b64(key.getEncoded())).putLong("session_until",System.currentTimeMillis()+30*60*1000L).apply();
        showHome();
    }

    void showHome() {
        base(); LinearLayout header=new LinearLayout(this); header.setGravity(Gravity.CENTER_VERTICAL); TextView title=text("PassOTP",24); title.setTypeface(null,1); header.addView(title,new LinearLayout.LayoutParams(0,-2,1)); Button lock=softButton("锁定"); header.addView(lock); root.addView(header);
        TextView subtitle=text("本地密码与 OTP",12); subtitle.setTextColor(Color.rgb(104,115,133)); root.addView(subtitle);
        LinearLayout tools=new LinearLayout(this); tools.setGravity(Gravity.CENTER_VERTICAL); CheckBox filter=new CheckBox(this); filter.setText("OTP"); filter.setTextSize(12); filter.setPadding(0,0,0,0); filter.setChecked(otpOnly); tools.addView(filter,new LinearLayout.LayoutParams(0,dp(48),1)); Button add=button("新增"); LinearLayout.LayoutParams addParams=new LinearLayout.LayoutParams(dp(74),dp(44));addParams.setMargins(dp(6),dp(2),0,dp(2));tools.addView(add,addParams); Button settings=softButton("数据"); LinearLayout.LayoutParams settingsParams=new LinearLayout.LayoutParams(dp(74),dp(44));settingsParams.setMargins(dp(6),dp(2),0,dp(2));tools.addView(settings,settingsParams); root.addView(tools);
        LinearLayout systemTools=new LinearLayout(this); Button autofill=softButton("启用系统自动填充"); systemTools.addView(autofill,new LinearLayout.LayoutParams(-1,dp(42))); root.addView(systemTools);
        filter.setOnCheckedChangeListener((b,c)->{otpOnly=c; renderList();}); add.setOnClickListener(v->edit(null)); settings.setOnClickListener(v->showDataMenu()); autofill.setOnClickListener(v->{try{startActivity(new Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE, Uri.parse("package:"+getPackageName())));}catch(Exception e){startActivity(new Intent(Settings.ACTION_SETTINGS));}}); lock.setOnClickListener(v->{key=null;entries.clear();prefs.edit().remove("session_key").remove("session_until").apply();showUnlock();});
        ScrollView scroll=new ScrollView(this); list=new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL); list.setPadding(0,dp(8),0,dp(16)); scroll.addView(list); root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1)); renderList();
        handler.removeCallbacksAndMessages(null); handler.postDelayed(new Runnable(){public void run(){updateOtpViews();handler.postDelayed(this,1000);}},500);
    }

    void renderList() {
        if(list==null)return; list.removeAllViews(); otpViews.clear();
        for(Entry e:entries) { if(otpOnly && e.otp.isEmpty()) continue; LinearLayout card=new LinearLayout(this); card.setOrientation(LinearLayout.VERTICAL); card.setPadding(dp(14),dp(10),dp(14),dp(10)); card.setBackground(shape(Color.WHITE,dp(14),Color.rgb(221,226,234))); LinearLayout.LayoutParams cardParams=new LinearLayout.LayoutParams(-1,-2);cardParams.setMargins(0,0,0,dp(8));
            LinearLayout top=new LinearLayout(this); TextView name=text(e.name.isEmpty()?"未命名":e.name,15); name.setTypeface(null,1); top.addView(name,new LinearLayout.LayoutParams(0,-2,1)); TextView code=text(e.otp.isEmpty()?"":"------",18); code.setTextColor(Color.rgb(23,105,170)); top.addView(code); card.addView(top); otpViews.add(code);
            TextView user=text(e.username,13); user.setTextColor(Color.rgb(104,115,133)); card.addView(user); LinearLayout actions=new LinearLayout(this); Button copyUser=softButton("账号"), copyPass=softButton("密码"), copyOtp=softButton("OTP"), edit=button("编辑"); addAction(actions,copyUser); addAction(actions,copyPass); if(!e.otp.isEmpty())addAction(actions,copyOtp); addAction(actions,edit); card.addView(actions); list.addView(card,cardParams);
            copyUser.setOnClickListener(v->copy(e.username)); copyPass.setOnClickListener(v->copy(e.password)); copyOtp.setOnClickListener(v->{try{copy(totp(e));}catch(Exception ignored){}}); edit.setOnClickListener(v->edit(e));
        }
        if(list.getChildCount()==0) list.addView(text(otpOnly?"暂无 OTP 项目":"暂无数据",14)); updateOtpViews();
    }
    void addAction(LinearLayout row,Button b){LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,dp(38),1);p.setMargins(dp(3),dp(4),dp(3),0);row.addView(b,p);}
    void updateOtpViews(){int i=0; for(Entry e:entries){if(otpOnly&&e.otp.isEmpty())continue; if(i>=otpViews.size())break; try{otpViews.get(i++).setText(e.otp.isEmpty()?"":totp(e));}catch(Exception ignored){}}}
    void copy(String value){((android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("PassOTP",value==null?"":value)); Toast.makeText(this,"已复制",Toast.LENGTH_SHORT).show();}

    void edit(Entry existing) {
        Dialog dialog=new Dialog(this); LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);panel.setPadding(dp(22),dp(18),dp(22),dp(18));
        TextView title=text(existing==null?"新增项目":"编辑项目",21);title.setTypeface(null,1);panel.addView(title);TextView hint=text("账号、密码和 OTP 将继续使用本地加密保存",12);hint.setTextColor(Color.rgb(104,115,133));panel.addView(hint);
        ScrollView scroll=new ScrollView(this);LinearLayout form=new LinearLayout(this);form.setOrientation(LinearLayout.VERTICAL);form.setPadding(0,dp(16),0,0);scroll.addView(form);
        EditText name=input("",false),url=input("https://example.com",false),user=input("",false),pass=input("",true),otp=input("Base32 或 otpauth://",false),notes=input("",false);name.setSingleLine(true);url.setSingleLine(true);user.setSingleLine(true);pass.setSingleLine(true);otp.setSingleLine(true);notes.setMinLines(3);notes.setGravity(Gravity.TOP);addField(form,"名称",name);addField(form,"网站地址（可选）",url);addField(form,"用户名",user);
        LinearLayout passwordRow=new LinearLayout(this);passwordRow.setGravity(Gravity.CENTER_VERTICAL);passwordRow.addView(pass,new LinearLayout.LayoutParams(0,dp(48),1));Button showPassword=softButton("显示");passwordRow.addView(showPassword,new LinearLayout.LayoutParams(dp(62),dp(44)));TextView passwordLabel=text("密码",12);passwordLabel.setTextColor(Color.rgb(104,115,133));form.addView(passwordLabel);form.addView(passwordRow);LinearLayout.LayoutParams passMargin=(LinearLayout.LayoutParams)passwordRow.getLayoutParams();passMargin.bottomMargin=dp(10);passwordRow.setLayoutParams(passMargin);showPassword.setOnClickListener(v->{boolean visible=pass.getInputType()!= (InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);pass.setInputType(visible?InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD:InputType.TYPE_CLASS_TEXT);showPassword.setText(visible?"显示":"隐藏");});
        addField(form,"OTP 密钥（可选）",otp);addField(form,"备注（可选）",notes);panel.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        if(existing!=null){name.setText(existing.name);url.setText(existing.url);user.setText(existing.username);pass.setText(existing.password);otp.setText(existing.otp);notes.setText(existing.notes);}
        final Entry[] target={existing};
        LinearLayout actions=new LinearLayout(this);actions.setGravity(Gravity.CENTER_VERTICAL);Button cancel=softButton("取消"),save=button("保存");actions.addView(cancel,new LinearLayout.LayoutParams(0,dp(48),1));actions.addView(save,new LinearLayout.LayoutParams(0,dp(48),1));if(target[0]!=null){Button delete=dangerButton("删除");actions.addView(delete,new LinearLayout.LayoutParams(0,dp(48),1));delete.setOnClickListener(v->new AlertDialog.Builder(this).setTitle("删除项目").setMessage("删除后无法恢复，确定继续吗？").setNegativeButton("取消",null).setPositiveButton("删除",(d,w)->{entries.remove(target[0]);try{saveVault();dialog.dismiss();renderList();}catch(Exception ignored){}}).show());}panel.addView(actions);dialog.setContentView(panel);cancel.setOnClickListener(v->dialog.dismiss());save.setOnClickListener(v->{String secret=normalizeOtp(otp.getText().toString());if(target[0]==null){target[0]=new Entry();target[0].id=UUID.randomUUID().toString();entries.add(0,target[0]);}target[0].name=name.getText().toString().trim();target[0].url=url.getText().toString().trim();target[0].username=user.getText().toString();target[0].password=pass.getText().toString();target[0].otp=secret;target[0].notes=notes.getText().toString();try{saveVault();dialog.dismiss();renderList();}catch(Exception e){Toast.makeText(this,"保存失败",Toast.LENGTH_SHORT).show();}});dialog.setOnShowListener(v->sizeDialog(dialog));dialog.show();sizeDialog(dialog);
    }

    void showDataMenu(){Dialog dialog=new Dialog(this);LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);panel.setPadding(dp(22),dp(18),dp(22),dp(18));TextView title=text("数据管理",21);title.setTypeface(null,1);panel.addView(title);TextView hint=text("导入或导出加密保险库文件",12);hint.setTextColor(Color.rgb(104,115,133));panel.addView(hint);Button importButton=button("导入加密保险库"),exportButton=softButton("导出加密保险库"),cancel=softButton("取消");LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,dp(48));p.topMargin=dp(16);panel.addView(importButton,p);LinearLayout.LayoutParams p2=new LinearLayout.LayoutParams(-1,dp(48));p2.topMargin=dp(8);panel.addView(exportButton,p2);LinearLayout.LayoutParams p3=new LinearLayout.LayoutParams(-1,dp(48));p3.topMargin=dp(8);panel.addView(cancel,p3);dialog.setContentView(panel);importButton.setOnClickListener(v->{dialog.dismiss();startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE),PICK_IMPORT);});exportButton.setOnClickListener(v->{dialog.dismiss();startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json").putExtra(Intent.EXTRA_TITLE,"passotp-vault.json"),CREATE_EXPORT);});cancel.setOnClickListener(v->dialog.dismiss());dialog.setOnShowListener(v->sizeDialog(dialog));dialog.show();sizeDialog(dialog);}
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
