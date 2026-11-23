package com.personal.tarotreader;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Hosts the Tarot Reader web app (bundled in assets) in a WebView and supplies
 * what a browser normally would: camera and file pickers, saving files, and the back button.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/index.html";
    private static final int REQ_PICK = 1, REQ_CAMERA = 2, REQ_SAVE = 3;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private File pendingSave;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        goEdgeToEdge();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF16121F);
        web = new WebView(this);
        web.setBackgroundColor(0xFF16121F);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        root.setOnApplyWindowInsetsListener(this::applyInsets);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(true);

        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return assets.shouldInterceptRequest(req.getUrl());
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return !HOST.equals(req.getUrl().getHost());   // the app never leaves its own pages
            }
        });
        web.setWebChromeClient(new Chrome());
        web.addJavascriptInterface(new Bridge(), "TarotNative");

        if (state != null) web.restoreState(state);
        else web.loadUrl(START_URL);
    }

    private void goEdgeToEdge() {
        Window w = getWindow();
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 30) w.setDecorFitsSystemWindows(false);
        else w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    /** Keep the page clear of the status bar, navigation bar, notch and keyboard. */
    @SuppressWarnings("deprecation")
    private WindowInsets applyInsets(View v, WindowInsets in) {
        if (Build.VERSION.SDK_INT >= 30) {
            android.graphics.Insets i = in.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsets.CONSUMED;
        }
        v.setPadding(in.getSystemWindowInsetLeft(), in.getSystemWindowInsetTop(),
                in.getSystemWindowInsetRight(), in.getSystemWindowInsetBottom());
        return in.consumeSystemWindowInsets();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("window.onNativeBack ? window.onNativeBack() : false", handled -> {
            if (!"true".equals(handled)) finish();
        });
    }

    // ---------- file pickers ----------
    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = cb;
            boolean images = false;
            for (String t : p.getAcceptTypes()) if (t != null && t.startsWith("image")) images = true;
            try {
                if (images && p.isCaptureEnabled()) openCamera();
                else {
                    Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType(images ? "image/*" : "*/*");
                    if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(i, REQ_PICK);
                }
            } catch (Exception e) {
                fileCallback = null;
                cb.onReceiveValue(null);
                Toast.makeText(MainActivity.this, "Could not open: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
            return true;
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            new AlertDialog.Builder(MainActivity.this, R.style.Dialog).setMessage(message)
                    .setPositiveButton("OK", (d, w) -> result.confirm())
                    .setOnCancelListener(d -> result.confirm()).show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            new AlertDialog.Builder(MainActivity.this, R.style.Dialog).setMessage(message)
                    .setPositiveButton("OK", (d, w) -> result.confirm())
                    .setNegativeButton("Cancel", (d, w) -> result.cancel())
                    .setOnCancelListener(d -> result.cancel()).show();
            return true;
        }
    }

    private void openCamera() {
        File dir = new File(getCacheDir(), "camera");
        dir.mkdirs();
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
        File photo = new File(dir, "spread-" + System.currentTimeMillis() + ".jpg");
        cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".files", photo);
        Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        i.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
        i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { startActivityForResult(i, REQ_CAMERA); }
        catch (ActivityNotFoundException e) { throw new RuntimeException("no camera app found"); }
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req == REQ_PICK || req == REQ_CAMERA) {
            Uri[] picked = null;
            if (result == RESULT_OK) {
                if (req == REQ_CAMERA) picked = new Uri[]{cameraUri};
                else if (data != null && data.getClipData() != null) {
                    ClipData c = data.getClipData();
                    picked = new Uri[c.getItemCount()];
                    for (int k = 0; k < c.getItemCount(); k++) picked[k] = c.getItemAt(k).getUri();
                } else if (data != null && data.getData() != null) picked = new Uri[]{data.getData()};
            }
            if (fileCallback != null) fileCallback.onReceiveValue(picked);
            fileCallback = null;
        } else if (req == REQ_SAVE) {
            boolean ok = false;
            if (result == RESULT_OK && data != null && data.getData() != null && pendingSave != null) {
                try (InputStream in = new FileInputStream(pendingSave);
                     OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    byte[] buf = new byte[1 << 16];
                    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                    ok = true;
                } catch (Exception e) {
                    Toast.makeText(this, "Could not save: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
            if (pendingSave != null) pendingSave.delete();
            pendingSave = null;
            if (ok) Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show();
        }
    }

    // ---------- saving files from the page (backups, CSV exports) ----------
    /** The page streams a file in base64 chunks; we then ask where to save it. */
    private class Bridge {
        private FileOutputStream out;
        private File tmp;

        @JavascriptInterface
        public boolean saveBegin(String name, String mime) {
            try {
                tmp = new File(getCacheDir(), "export.tmp");
                out = new FileOutputStream(tmp);
                saveName = name; saveMime = mime;
                return true;
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public boolean saveChunk(String b64) {
            try { out.write(Base64.decode(b64, Base64.DEFAULT)); return true; }
            catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public boolean saveEnd() {
            try { out.close(); } catch (Exception e) { return false; }
            final File f = tmp;
            runOnUiThread(() -> {
                pendingSave = f;
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(saveMime == null || saveMime.isEmpty() ? "application/octet-stream" : saveMime);
                i.putExtra(Intent.EXTRA_TITLE, saveName);
                startActivityForResult(i, REQ_SAVE);
            });
            return true;
        }
    }
    private String saveName, saveMime;
}
