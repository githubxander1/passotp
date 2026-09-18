# PassOTP Android

这是 PassOTP 的 Android 客户端初版，使用原生 Java 和 Android SDK，不依赖第三方库。

## 已实现

- 与 Edge 扩展兼容的 PBKDF2-HMAC-SHA256（210000 次）+ AES-256-GCM 保险库格式
- 使用同一主密码解锁现有扩展导出的加密 JSON
- 查看、新增、编辑账号和 OTP
- TOTP 计算与复制账号、密码、OTP
- 加密保险库导入和导出

## 打开和构建

在 Android Studio 中选择本目录下的 `android` 文件夹打开，等待 Gradle 同步后运行 `app`。

当前 Android 客户端版本：`0.2.2`。

当前版本已接入 Android Autofill Service 和生物识别解锁入口。WebDAV 同步尚未接入，数据格式已经与扩展统一。
