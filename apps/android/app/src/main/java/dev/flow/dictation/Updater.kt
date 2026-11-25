package dev.flow.dictation

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.widget.Toast
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

data class UpdateInfo(val version: String, val apkUrl: String, val shaUrl: String)

/**
 * Updates Flow from its own GitHub releases. The APK is only installed if its SHA-256 matches the
 * checksum published beside it, and Android always asks the user to confirm the install.
 */
object Updater {
    private const val LATEST = "https://api.github.com/repos/thecoatcard/flow-dictation/releases/latest"
    private const val DOWNLOADS = "https://github.com/thecoatcard/flow-dictation/releases/download/"
    private const val MAX_APK_BYTES = 60L * 1024 * 1024
    private val apkName = Regex("^Flow-Android-(\\d+\\.\\d+\\.\\d+)\\.apk$")
    private val http = OkHttpClient.Builder().callTimeout(60, TimeUnit.SECONDS).build()

    /** True when [candidate] is a higher dotted version than [current]; missing parts count as 0. */
    internal fun isNewer(candidate: String, current: String): Boolean {
        val a = candidate.split('.').map { it.toIntOrNull() ?: 0 }
        val b = current.split('.').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }
            val y = b.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        return false
    }

    /** The first 64-hex-digit token of a `.sha256` file ("hash *name" or "hash  name"). */
    internal fun parseSha(text: String): String? =
        Regex("^[0-9a-fA-F]{64}").find(text.trim())?.value?.lowercase()

    fun installedVersion(context: Context): String =
        context.packageManager.getPackageInfo(context.packageName, 0).versionName.orEmpty()

    fun readyFile(context: Context, version: String) = File(File(context.cacheDir, "updates"), "Flow-Android-$version.apk")

    /** The newer release's APK, or null when Flow is up to date. Throws on network or format problems. */
    suspend fun check(context: Context): UpdateInfo? = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(LATEST).header("Accept", "application/vnd.github+json").build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Could not check for updates (HTTP ${response.code}).")
            val assets = JSONObject(response.body?.string().orEmpty()).getJSONArray("assets")
            var apk: Triple<String, String, String>? = null // version, name, url
            val urls = HashMap<String, String>()
            for (i in 0 until assets.length()) {
                val asset = assets.getJSONObject(i)
                val name = asset.getString("name")
                val url = asset.getString("browser_download_url")
                if (!url.startsWith(DOWNLOADS)) continue // only ever download from this project's releases
                urls[name] = url
                apkName.find(name)?.let { apk = Triple(it.groupValues[1], name, url) }
            }
            val (version, name, url) = apk ?: return@use null
            val sha = urls["$name.sha256"] ?: return@use null
            if (isNewer(version, installedVersion(context))) UpdateInfo(version, url, sha) else null
        }
    }

    /** Downloads the APK into the app's private cache and verifies its checksum. Returns the verified file. */
    suspend fun download(context: Context, info: UpdateInfo): File = withContext(Dispatchers.IO) {
        val file = readyFile(context, info.version)
        file.parentFile?.apply { mkdirs(); listFiles()?.filter { it != file }?.forEach { it.delete() } }
        val expected = http.newCall(Request.Builder().url(info.shaUrl).build()).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Could not read the update checksum.")
            parseSha(response.body?.string().orEmpty()) ?: throw IOException("The update checksum is invalid.")
        }
        val digest = MessageDigest.getInstance("SHA-256")
        http.newCall(Request.Builder().url(info.apkUrl).build()).execute().use { response ->
            val body = response.body
            if (!response.isSuccessful || body == null) throw IOException("Could not download the update.")
            var total = 0L
            file.outputStream().use { out ->
                body.byteStream().use { input ->
                    val buffer = ByteArray(16 * 1024)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        total += n
                        if (total > MAX_APK_BYTES) throw IOException("The update file is too large.")
                        digest.update(buffer, 0, n)
                        out.write(buffer, 0, n)
                    }
                }
            }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (actual != expected) {
            file.delete()
            throw IOException("The download did not match its checksum, so it was not installed.")
        }
        file
    }

    /** Hands a verified APK to Android's installer. The system shows its own confirmation. */
    fun install(context: Context, file: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        if (Build.VERSION.SDK_INT >= 31)
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            file.inputStream().use { input ->
                session.openWrite("flow.apk", 0, file.length()).use { out ->
                    input.copyTo(out)
                    session.fsync(out)
                }
            }
            val callback = Intent(context, UpdateReceiver::class.java).setPackage(context.packageName)
            val pending = PendingIntent.getBroadcast(
                context, id, callback, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )
            session.commit(pending.intentSender)
        }
    }
}

/** Receives the installer's result: shows Android's confirmation, or says why the update failed. */
class UpdateReceiver : BroadcastReceiver() {
    @Suppress("DEPRECATION")
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> Unit // Android restarts Flow on the new version
            PackageInstaller.STATUS_FAILURE_BLOCKED, PackageInstaller.STATUS_FAILURE_ABORTED ->
                Toast.makeText(
                    context,
                    "The update was blocked or cancelled. If Play Protect blocked it, install the APK from your computer with adb (see the guide).",
                    Toast.LENGTH_LONG
                ).show()
            PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ->
                Toast.makeText(
                    context,
                    "Update not installed: it was signed with a different key. Uninstall Flow and install the new APK.",
                    Toast.LENGTH_LONG
                ).show()
            else -> Toast.makeText(context, "The update could not be installed.", Toast.LENGTH_LONG).show()
        }
    }
}
