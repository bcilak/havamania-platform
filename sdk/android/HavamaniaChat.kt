// HavamaniaChat.kt
// Havamania Asistan sohbet ekranını WebView içinde açar.
//
// Bağımlılıklar: androidx.activity, androidx.core (çoğu projede zaten var).
//
// AndroidManifest.xml:
//   <uses-permission android:name="android.permission.INTERNET" />
//   <activity android:name=".HavamaniaChatActivity"
//             android:theme="@style/Theme.AppCompat.Light.NoActionBar"
//             android:windowSoftInputMode="adjustResize" />
//
// Kullanım:
//   HavamaniaChat.open(context, botKey = "hm_pk_BOT_ANAHTARI", userToken = token, mode = HavamaniaChat.Mode.AGRO)

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.util.Locale

object HavamaniaChat {
    enum class Mode(val value: String) { GENEL("genel"), AGRO("agro"), FLY("fly") }

    data class Location(val lat: Double, val lon: Double, val name: String? = null)

    const val BASE_URL = "https://havamania.com"

    fun open(
        context: Context,
        botKey: String,
        userToken: String? = null,
        mode: Mode = Mode.GENEL,
        lockMode: Boolean = false,
        location: Location? = null,
        baseUrl: String = BASE_URL,
    ) {
        val deviceId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        val appVersion = runCatching {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        }.getOrNull()

        val uri = Uri.parse("$baseUrl/w/$botKey").buildUpon()
            .appendQueryParameter("platform", "android")
            .appendQueryParameter("deviceId", deviceId)
            .appendQueryParameter("mode", mode.value)
            .appendQueryParameter("locale", Locale.getDefault().toLanguageTag())
            .apply {
                appVersion?.let { appendQueryParameter("appVersion", it) }
                if (lockMode) appendQueryParameter("lockMode", "1")
                location?.let {
                    appendQueryParameter("lat", it.lat.toString())
                    appendQueryParameter("lon", it.lon.toString())
                    it.name?.let { n -> appendQueryParameter("place", n) }
                }
                // Token URL'nin # kısmında: sunucuya ve loglara gitmez.
                userToken?.let { encodedFragment("token=" + Uri.encode(it)) }
            }
            .build()

        context.startActivity(
            Intent(context, HavamaniaChatActivity::class.java)
                .putExtra("url", uri.toString())
                .addFlags(if (context is android.app.Activity) 0 else Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}

class HavamaniaChatActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    // Android WebView dosya seçiciyi kendisi açmaz; burada karşılanır.
    private val pickImages = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        fileCallback?.onReceiveValue(uris.toTypedArray())
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val url = intent.getStringExtra("url") ?: return finish()
        val host = Uri.parse(url).host

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            addJavascriptInterface(Bridge(), "HavamaniaAndroid")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    // Sohbet dışındaki bağlantılar tarayıcıda açılır.
                    if (request.url.host != host) {
                        startActivity(Intent(Intent.ACTION_VIEW, request.url))
                        return true
                    }
                    return false
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams,
                ): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = callback
                    pickImages.launch("image/*")
                    return true
                }
            }
        }

        // Android 15 kenardan kenara çizer: durum çubuğu, gezinme çubuğu ve
        // klavye kadar boşluk bırak ki yazma alanı altlarında kalmasın.
        ViewCompat.setOnApplyWindowInsetsListener(webView) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        onBackPressedDispatcher.addCallback(this) { finish() }

        setContentView(webView)
        webView.loadUrl(url)
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null)
        webView.destroy()
        super.onDestroy()
    }

    private inner class Bridge {
        @JavascriptInterface
        fun postMessage(json: String) {
            val type = runCatching { JSONObject(json).optString("type") }.getOrNull()
            if (type == "close") runOnUiThread { finish() }
        }
    }
}
