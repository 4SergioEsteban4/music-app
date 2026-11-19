package com.lmusic.app;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.util.Base64;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.ShortBuffer;
import java.nio.charset.Charset;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Puente entre la app web (React) y Android:
 *  - escanea los mp3 del teléfono con MediaStore
 *  - controla la reproducción (ExoPlayer dentro de PlaybackService)
 */
@CapacitorPlugin(
        name = "LMusic",
        permissions = {
                @Permission(alias = "audio", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
                @Permission(alias = "audioLegacy", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
                @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
        })
public class LMusicPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    // Las portadas se extraen en sus propios hilos para no bloquear al resto de llamadas
    private final ExecutorService coverExecutor = Executors.newFixedThreadPool(2);
    // El análisis de BPM usa mucho procesador: uno a la vez
    private final ExecutorService analysisExecutor = Executors.newSingleThreadExecutor();
    // Escritura de etiquetas en los archivos: de uno en uno
    private final ExecutorService fileExecutor = Executors.newSingleThreadExecutor();
    private ActivityResultLauncher<IntentSenderRequest> writeLauncher;
    private Runnable pendingWrite;
    private PluginCall pendingWriteCall;
    private ListenableFuture<MediaController> controllerFuture;
    private MediaController controller;

    private long loopStartMs = -1;
    private long loopEndMs = -1;
    private final Runnable loopTicker = new Runnable() {
        @Override
        public void run() {
            if (controller == null || loopEndMs <= 0) return;
            if (controller.isPlaying()) {
                long pos = controller.getCurrentPosition();
                if (pos >= loopEndMs || pos < loopStartMs - 1500) controller.seekTo(loopStartMs);
            }
            main.postDelayed(this, 40);
        }
    };

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (controller != null && controller.isPlaying()) {
                emitProgress();
                main.postDelayed(this, 200);
            }
        }
    };

    private final Player.Listener listener = new Player.Listener() {
        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            emitState();
            main.removeCallbacks(ticker);
            if (isPlaying) main.post(ticker);
        }

        @Override
        public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
            loopEndMs = -1;
            main.removeCallbacks(loopTicker);
            JSObject o = new JSObject();
            o.put("mediaId", item != null ? item.mediaId : "");
            o.put("index", controller != null ? controller.getCurrentMediaItemIndex() : 0);
            notifyListeners("transition", o);
            emitState();
        }

        @Override
        public void onPlaybackStateChanged(int state) {
            emitState();
        }

        @Override
        public void onShuffleModeEnabledChanged(boolean enabled) {
            emitState();
        }

        @Override
        public void onRepeatModeChanged(int mode) {
            emitState();
        }

        @Override
        public void onPlaybackParametersChanged(PlaybackParameters params) {
            emitState();
        }

        @Override
        public void onPlayerError(PlaybackException error) {
            JSObject o = new JSObject();
            o.put("message", error.getMessage() != null ? error.getMessage() : "Error de reproducción");
            MediaItem cur = controller != null ? controller.getCurrentMediaItem() : null;
            o.put("mediaId", cur != null ? cur.mediaId : "");
            notifyListeners("error", o);
            // Saltar a la siguiente canción si existe
            if (controller != null && controller.hasNextMediaItem()) {
                controller.seekToNextMediaItem();
                controller.prepare();
                controller.play();
            }
        }
    };

    /* ------------------------------------------------------------------ */
    /* Conexión con el servicio de reproducción                            */
    /* ------------------------------------------------------------------ */

    @Override
    public void load() {
        main.post(this::connectController);
        try {
            // Permiso del sistema para modificar archivos de audio (Android 11 o superior)
            writeLauncher = getActivity().registerForActivityResult(
                    new ActivityResultContracts.StartIntentSenderForResult(), result -> {
                        Runnable job = pendingWrite;
                        PluginCall pc = pendingWriteCall;
                        pendingWrite = null;
                        pendingWriteCall = null;
                        if (result.getResultCode() == Activity.RESULT_OK && job != null) {
                            fileExecutor.execute(job);
                        } else if (pc != null) {
                            pc.reject("No diste permiso para modificar los archivos.");
                        }
                    });
        } catch (Exception e) {
            writeLauncher = null;
        }
        cleanOldOriginals();
    }

    private void connectController() {
        if (controllerFuture != null) return;
        SessionToken token = new SessionToken(
                getContext(), new ComponentName(getContext(), PlaybackService.class));
        controllerFuture = new MediaController.Builder(getContext(), token).buildAsync();
        controllerFuture.addListener(() -> {
            try {
                controller = controllerFuture.get();
                controller.addListener(listener);
                emitState();
            } catch (Exception e) {
                controller = null;
            }
        }, ContextCompat.getMainExecutor(getContext()));
    }

    @Override
    protected void handleOnDestroy() {
        main.removeCallbacks(loopTicker);
        coverExecutor.shutdownNow();
        analysisExecutor.shutdownNow();
        fileExecutor.shutdownNow();
        main.removeCallbacks(ticker);
        if (controllerFuture != null) {
            MediaController.releaseFuture(controllerFuture);
            controllerFuture = null;
            controller = null;
        }
        super.handleOnDestroy();
    }

    private interface Action {
        JSObject run(MediaController c) throws Exception;
    }

    /** Ejecuta una acción en el hilo principal cuando el controlador está listo. */
    private void withController(final PluginCall call, final Action action) {
        main.post(() -> {
            connectController();
            controllerFuture.addListener(() -> {
                try {
                    if (controller == null) {
                        controller = controllerFuture.get();
                        controller.addListener(listener);
                    }
                    JSObject res = action.run(controller);
                    if (res == null) call.resolve();
                    else call.resolve(res);
                } catch (Exception e) {
                    call.reject("Error del reproductor: " + e.getMessage());
                }
            }, ContextCompat.getMainExecutor(getContext()));
        });
    }

    /* ------------------------------------------------------------------ */
    /* Estado                                                              */
    /* ------------------------------------------------------------------ */

    private static String repeatName(int mode) {
        if (mode == Player.REPEAT_MODE_ALL) return "all";
        if (mode == Player.REPEAT_MODE_ONE) return "one";
        return "off";
    }

    private JSObject buildState(boolean withQueue) {
        JSObject s = new JSObject();
        MediaController c = controller;
        if (c == null) {
            s.put("ready", false);
            return s;
        }
        s.put("ready", true);
        s.put("isPlaying", c.isPlaying());
        s.put("playWhenReady", c.getPlayWhenReady());
        s.put("index", c.getCurrentMediaItemIndex());
        MediaItem cur = c.getCurrentMediaItem();
        s.put("mediaId", cur != null ? cur.mediaId : "");
        s.put("positionMs", Math.max(0L, c.getCurrentPosition()));
        long d = c.getDuration();
        s.put("durationMs", d < 0 ? 0L : d);
        s.put("shuffle", c.getShuffleModeEnabled());
        s.put("repeat", repeatName(c.getRepeatMode()));
        s.put("speed", (double) c.getPlaybackParameters().speed);
        if (withQueue) {
            JSArray ids = new JSArray();
            for (int i = 0; i < c.getMediaItemCount(); i++) {
                ids.put(c.getMediaItemAt(i).mediaId);
            }
            s.put("queue", ids);
        }
        return s;
    }

    private void emitState() {
        notifyListeners("state", buildState(false));
    }

    private void emitProgress() {
        if (controller == null) return;
        JSObject o = new JSObject();
        o.put("positionMs", Math.max(0L, controller.getCurrentPosition()));
        long d = controller.getDuration();
        o.put("durationMs", d < 0 ? 0L : d);
        notifyListeners("progress", o);
    }

    @PluginMethod
    public void getState(PluginCall call) {
        withController(call, c -> buildState(true));
    }

    /* ------------------------------------------------------------------ */
    /* Permisos                                                            */
    /* ------------------------------------------------------------------ */

    private String audioAlias() {
        return Build.VERSION.SDK_INT >= 33 ? "audio" : "audioLegacy";
    }

    private boolean audioGranted() {
        return getPermissionState(audioAlias()) == PermissionState.GRANTED;
    }

    private boolean notificationsGranted() {
        return Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED;
    }

    private JSObject accessResult() {
        JSObject r = new JSObject();
        r.put("audio", audioGranted());
        r.put("notifications", notificationsGranted());
        return r;
    }

    @PluginMethod
    public void checkAccess(PluginCall call) {
        call.resolve(accessResult());
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        ArrayList<String> aliases = new ArrayList<>();
        if (!audioGranted()) aliases.add(audioAlias());
        if (!notificationsGranted()) aliases.add("notifications");
        if (aliases.isEmpty()) {
            call.resolve(accessResult());
            return;
        }
        requestPermissionForAliases(aliases.toArray(new String[0]), call, "accessCallback");
    }

    @PermissionCallback
    private void accessCallback(PluginCall call) {
        call.resolve(accessResult());
    }

    /* ------------------------------------------------------------------ */
    /* Escaneo de la biblioteca                                            */
    /* ------------------------------------------------------------------ */

    private static String clean(@Nullable String s) {
        if (s == null) return "";
        s = s.trim();
        return "<unknown>".equals(s) ? "" : s;
    }

    private static String stripExtension(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
    }

    @PluginMethod
    public void scanLibrary(PluginCall call) {
        if (!audioGranted()) {
            call.reject("Sin permiso para leer audio");
            return;
        }
        Uri collection = Build.VERSION.SDK_INT >= 29
                ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
                : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;

        ArrayList<String> proj = new ArrayList<>(Arrays.asList(
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.DISPLAY_NAME,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.ALBUM_ID,
                MediaStore.Audio.Media.TRACK,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.DATE_ADDED,
                MediaStore.Audio.Media.SIZE));
        boolean hasGenre = Build.VERSION.SDK_INT >= 30;
        if (hasGenre) proj.add(MediaStore.Audio.Media.GENRE);

        String selection = MediaStore.Audio.Media.IS_MUSIC + " != 0 AND "
                + MediaStore.Audio.Media.DURATION + " >= 10000";

        JSArray out = new JSArray();
        try (Cursor c = getContext().getContentResolver().query(
                collection, proj.toArray(new String[0]), selection, null,
                MediaStore.Audio.Media.TITLE + " COLLATE NOCASE ASC")) {
            if (c != null) {
                int iId = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                int iName = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME);
                int iTitle = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
                int iArtist = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
                int iAlbum = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
                int iAlbumId = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID);
                int iTrack = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TRACK);
                int iDur = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
                int iAdded = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED);
                int iSize = c.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE);
                int iGenre = hasGenre ? c.getColumnIndexOrThrow(MediaStore.Audio.Media.GENRE) : -1;

                while (c.moveToNext()) {
                    long id = c.getLong(iId);
                    String title = clean(c.getString(iTitle));
                    if (title.isEmpty()) title = stripExtension(c.getString(iName));

                    JSObject t = new JSObject();
                    t.put("id", id);
                    t.put("uri", ContentUris.withAppendedId(collection, id).toString());
                    t.put("title", title);
                    t.put("artist", clean(c.getString(iArtist)));
                    t.put("album", clean(c.getString(iAlbum)));
                    t.put("albumId", c.getLong(iAlbumId));
                    t.put("genre", iGenre >= 0 ? clean(c.getString(iGenre)) : "");
                    t.put("trackNo", c.getInt(iTrack) % 1000); // TRACK = disco*1000 + pista
                    t.put("durationMs", c.getLong(iDur));
                    t.put("dateAdded", c.getLong(iAdded));
                    t.put("size", c.getLong(iSize));
                    t.put("fileName", c.getString(iName) != null ? c.getString(iName) : "");
                    out.put(t);
                }
            }
        } catch (Exception e) {
            call.reject("No se pudo leer la biblioteca: " + e.getMessage());
            return;
        }
        JSObject res = new JSObject();
        res.put("tracks", out);
        call.resolve(res);
    }


    /**
     * Capacitor's PluginCall.getLong solo acepta valores de tipo Long, pero el JSON trae los números
     * pequeños como Integer: devolvía siempre el valor por defecto (0). Esto lee cualquier número.
     */
    private static long longArg(PluginCall call, String name, long def) {
        return call.getData().optLong(name, def);
    }

    /* ------------------------------------------------------------------ */
    /* Reproducción                                                        */
    /* ------------------------------------------------------------------ */

    @PluginMethod
    public void setQueue(PluginCall call) {
        JSArray arr = call.getArray("tracks");
        final int start = call.getInt("startIndex", 0);
        Boolean playOpt = call.getBoolean("play", true);
        final boolean play = playOpt == null || playOpt;
        if (arr == null || arr.length() == 0) {
            call.reject("La cola está vacía");
            return;
        }
        final ArrayList<MediaItem> items = new ArrayList<>();
        try {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject t = arr.getJSONObject(i);
                MediaMetadata md = new MediaMetadata.Builder()
                        .setTitle(t.optString("title"))
                        .setArtist(t.optString("artist"))
                        .setAlbumTitle(t.optString("album"))
                        .build();
                items.add(new MediaItem.Builder()
                        .setMediaId(String.valueOf(t.getLong("id")))
                        .setUri(Uri.parse(t.getString("uri")))
                        .setMediaMetadata(md)
                        .build());
            }
        } catch (JSONException e) {
            call.reject("Cola inválida: " + e.getMessage());
            return;
        }
        withController(call, c -> {
            c.setMediaItems(items, Math.max(0, Math.min(start, items.size() - 1)), 0L);
            c.prepare();
            if (play) c.play();
            return null;
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        withController(call, c -> {
            if (c.getPlaybackState() == Player.STATE_IDLE) c.prepare();
            c.play();
            return null;
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        withController(call, c -> {
            c.pause();
            return null;
        });
    }

    @PluginMethod
    public void next(PluginCall call) {
        withController(call, c -> {
            c.seekToNext();
            return null;
        });
    }

    @PluginMethod
    public void previous(PluginCall call) {
        withController(call, c -> {
            c.seekToPrevious(); // si va más de 3 s, reinicia la canción actual
            return null;
        });
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        final long pos = longArg(call, "positionMs", 0L);
        withController(call, c -> {
            c.seekTo(pos);
            emitProgress();
            return null;
        });
    }

    @PluginMethod
    public void setShuffle(PluginCall call) {
        Boolean e = call.getBoolean("enabled", false);
        final boolean enabled = e != null && e;
        withController(call, c -> {
            c.setShuffleModeEnabled(enabled);
            return null;
        });
    }

    @PluginMethod
    public void setRepeat(PluginCall call) {
        final String mode = call.getString("mode", "off");
        withController(call, c -> {
            if ("all".equals(mode)) c.setRepeatMode(Player.REPEAT_MODE_ALL);
            else if ("one".equals(mode)) c.setRepeatMode(Player.REPEAT_MODE_ONE);
            else c.setRepeatMode(Player.REPEAT_MODE_OFF);
            return null;
        });
    }

    @PluginMethod
    public void setSpeed(PluginCall call) {
        Float sp = call.getFloat("speed", 1f);
        final float speed = sp == null ? 1f : sp;
        withController(call, c -> {
            c.setPlaybackSpeed(speed); // conserva el tono
            return null;
        });
    }

    /* ------------------------------------------------------------------ */
    /* Portadas                                                            */
    /* ------------------------------------------------------------------ */

    private static Bitmap decodeScaled(byte[] data, int maxSide) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(data, 0, data.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;

        int longest = Math.max(bounds.outWidth, bounds.outHeight);
        int sample = 1;
        while (longest / (sample * 2) >= maxSide) sample *= 2;

        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        Bitmap b = BitmapFactory.decodeByteArray(data, 0, data.length, opts);
        if (b == null) return null;

        int l = Math.max(b.getWidth(), b.getHeight());
        if (l > maxSide) {
            float k = (float) maxSide / l;
            Bitmap scaled = Bitmap.createScaledBitmap(
                    b, Math.round(b.getWidth() * k), Math.round(b.getHeight() * k), true);
            if (scaled != b) b.recycle();
            return scaled;
        }
        return b;
    }

    /**
     * Extrae la portada incrustada del mp3 (o la miniatura de MediaStore) y la guarda
     * en caché como JPEG. Devuelve la ruta del archivo, o "" si no hay portada.
     */
    @PluginMethod
    public void getCover(final PluginCall call) {
        final long id = longArg(call, "id", 0L);
        final String uri = call.getString("uri");
        final Integer sizeObj = call.getInt("size", 720);
        final int size = sizeObj == null ? 720 : sizeObj;
        if (uri == null) {
            call.reject("Falta la uri");
            return;
        }
        coverExecutor.execute(() -> {
            JSObject res = new JSObject();
            // 1) portadas elegidas por el usuario o bajadas de internet (carpeta persistente)
            File saved = new File(new File(getContext().getFilesDir(), "covers"), id + "_" + size + ".jpg");
            if (saved.exists() && saved.length() > 0) {
                res.put("path", saved.getAbsolutePath());
                call.resolve(res);
                return;
            }
            // 2) portada incrustada en el mp3 (caché: Android puede borrarla y se vuelve a extraer)
            File dir = new File(getContext().getCacheDir(), "covers3");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            File out = new File(dir, id + "_" + size + ".jpg");
            File none = new File(dir, id + ".none");

            if (out.exists() && out.length() > 0) {
                res.put("path", out.getAbsolutePath());
                call.resolve(res);
                return;
            }
            if (none.exists()) {
                res.put("path", "");
                call.resolve(res);
                return;
            }

            Bitmap bmp = null;
            byte[] pic = null;
            MediaMetadataRetriever r = new MediaMetadataRetriever();
            try {
                r.setDataSource(getContext(), Uri.parse(uri));
                pic = r.getEmbeddedPicture();
            } catch (Exception ignored) {
                // sin etiquetas legibles: probamos la miniatura del sistema
            } finally {
                try {
                    r.release();
                } catch (Exception ignored) {
                }
            }
            if (pic != null) bmp = decodeScaled(pic, size);

            // OJO: no se usa la miniatura de MediaStore, porque es la del ÁLBUM entero y haría que
            // todas las canciones de una carpeta muestren la misma imagen.

            if (bmp == null) {
                try {
                    //noinspection ResultOfMethodCallIgnored
                    none.createNewFile();
                } catch (Exception ignored) {
                }
                res.put("path", "");
                call.resolve(res);
                return;
            }

            try (FileOutputStream fos = new FileOutputStream(out)) {
                bmp.compress(Bitmap.CompressFormat.JPEG, 90, fos);
            } catch (Exception e) {
                call.reject("No se pudo guardar la portada: " + e.getMessage());
                return;
            } finally {
                bmp.recycle();
            }
            res.put("path", out.getAbsolutePath());
            call.resolve(res);
        });
    }

    /* ------------------------------------------------------------------ */
    /* BPM y rejilla de pulsos                                             */
    /* ------------------------------------------------------------------ */

    private static int readFully(InputStream in, byte[] buf) throws IOException {
        int off = 0;
        while (off < buf.length) {
            int n = in.read(buf, off, buf.length - off);
            if (n < 0) break;
            off += n;
        }
        return off;
    }

    private static int synchsafe(byte[] b, int o) {
        return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
    }

    private static int be32(byte[] b, int o) {
        return ((b[o] & 0xff) << 24) | ((b[o + 1] & 0xff) << 16) | ((b[o + 2] & 0xff) << 8) | (b[o + 3] & 0xff);
    }

    private static String id3Text(byte[] b, int off, int len) {
        if (len < 2) return "";
        Charset cs;
        switch (b[off]) {
            case 1: cs = StandardCharsets.UTF_16; break;
            case 2: cs = StandardCharsets.UTF_16BE; break;
            case 3: cs = StandardCharsets.UTF_8; break;
            default: cs = StandardCharsets.ISO_8859_1;
        }
        return new String(b, off + 1, len - 1, cs).replace("\u0000", "").trim();
    }

    /** Lee el BPM guardado en la etiqueta ID3v2 (campo TBPM). Devuelve 0 si no hay. */
    private double readId3Bpm(Uri uri) {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) return 0;
            byte[] h = new byte[10];
            if (readFully(in, h) != 10) return 0;
            if (h[0] != 'I' || h[1] != 'D' || h[2] != '3') return 0;
            int ver = h[3];
            if (ver < 3) return 0; // ID3v2.2 usa otro formato; se resuelve con el análisis
            int flags = h[5];
            int size = synchsafe(h, 6);
            if (size <= 0) return 0;
            byte[] tag = new byte[Math.min(size, 1 << 20)];
            int n = readFully(in, tag);
            int pos = 0;
            if ((flags & 0x40) != 0 && n >= 4) {
                pos = ver == 4 ? synchsafe(tag, 0) : be32(tag, 0) + 4;
            }
            while (pos + 10 <= n) {
                if (tag[pos] == 0) break;
                String id = new String(tag, pos, 4, StandardCharsets.ISO_8859_1);
                int fsize = ver == 4 ? synchsafe(tag, pos + 4) : be32(tag, pos + 4);
                if (fsize <= 0 || pos + 10 + fsize > n) break;
                if ("TBPM".equals(id)) {
                    Matcher m = Pattern.compile("[0-9]+(\\.[0-9]+)?").matcher(id3Text(tag, pos + 10, fsize));
                    if (m.find()) {
                        double v = Double.parseDouble(m.group());
                        return v >= 40 && v <= 250 ? v : 0;
                    }
                    return 0;
                }
                pos += 10 + fsize;
            }
        } catch (Exception ignored) {
            // sin etiqueta legible
        }
        return 0;
    }

    private static final class Pcm {
        final short[] data;
        final int length;
        final int sampleRate;
        final double startSec;

        Pcm(short[] data, int length, int sampleRate, double startSec) {
            this.data = data;
            this.length = length;
            this.sampleRate = sampleRate;
            this.startSec = startSec;
        }
    }

    /** Decodifica un tramo del audio a PCM mono de 16 bits. */
    private Pcm decodeMono(Uri uri, long wantStartUs, long maxUs) throws Exception {
        MediaExtractor ex = new MediaExtractor();
        MediaCodec codec = null;
        try {
            ex.setDataSource(getContext(), uri, null);
            int track = -1;
            MediaFormat fmt = null;
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat f = ex.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    track = i;
                    fmt = f;
                    break;
                }
            }
            if (track < 0 || fmt == null) throw new IOException("Sin pista de audio");
            ex.selectTrack(track);

            long durUs = fmt.containsKey(MediaFormat.KEY_DURATION) ? fmt.getLong(MediaFormat.KEY_DURATION) : 0;
            long startUs = (durUs > wantStartUs + maxUs) ? wantStartUs : 0;
            if (startUs > 0) ex.seekTo(startUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC);
            long limitUs = startUs + maxUs;

            int sampleRate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int channels = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT);

            codec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME));
            codec.configure(fmt, null, null, 0);
            codec.start();

            short[] out = new short[(int) ((maxUs / 1_000_000.0 + 2) * sampleRate)];
            int outLen = 0;
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean inputDone = false;
            boolean outputDone = false;

            while (!outputDone) {
                if (!inputDone) {
                    int ii = codec.dequeueInputBuffer(10_000);
                    if (ii >= 0) {
                        ByteBuffer ib = codec.getInputBuffer(ii);
                        int sz = ib != null ? ex.readSampleData(ib, 0) : -1;
                        long t = ex.getSampleTime();
                        if (sz < 0 || t > limitUs) {
                            codec.queueInputBuffer(ii, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            codec.queueInputBuffer(ii, 0, sz, t, 0);
                            ex.advance();
                        }
                    }
                }
                int oi = codec.dequeueOutputBuffer(info, 10_000);
                if (oi >= 0) {
                    ByteBuffer ob = codec.getOutputBuffer(oi);
                    if (info.size > 0 && ob != null) {
                        ob.position(info.offset);
                        ob.limit(info.offset + info.size);
                        ShortBuffer sb = ob.order(ByteOrder.nativeOrder()).asShortBuffer();
                        int frames = sb.remaining() / Math.max(1, channels);
                        for (int f = 0; f < frames && outLen < out.length; f++) {
                            int sum = 0;
                            for (int c = 0; c < channels; c++) sum += sb.get();
                            out[outLen++] = (short) (sum / channels);
                        }
                    }
                    codec.releaseOutputBuffer(oi, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true;
                } else if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat nf = codec.getOutputFormat();
                    sampleRate = nf.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    channels = nf.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                }
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
            }
            return new Pcm(out, outLen, sampleRate, startUs / 1_000_000.0);
        } finally {
            try {
                if (codec != null) {
                    codec.stop();
                    codec.release();
                }
            } catch (Exception ignored) {
            }
            ex.release();
        }
    }

    /** Fuerza de ataque (subidas de energía) en dos bandas: todo el espectro y graves. */
    private static double[] onsetEnvelope(Pcm pcm, int hop) {
        int blocks = pcm.length / hop;
        if (blocks < 100) return null;
        double[] bf = new double[blocks];
        double[] bl = new double[blocks];
        double a = 1 - Math.exp(-2 * Math.PI * 200.0 / pcm.sampleRate);
        double lp = 0;
        for (int b = 0; b < blocks; b++) {
            double sf = 0;
            double sl = 0;
            int s0 = b * hop;
            for (int i = 0; i < hop; i++) {
                double v = pcm.data[s0 + i] / 32768.0;
                lp += a * (v - lp);
                sf += v * v;
                sl += lp * lp;
            }
            bf[b] = sf;
            bl[b] = sl;
        }
        int frames = blocks - 1;
        double[] o = new double[frames];
        double prevF = Math.log(1 + 100.0 * (bf[0] + bf[1]) / hop);
        double prevL = Math.log(1 + 100.0 * (bl[0] + bl[1]) / hop);
        for (int i = 1; i < frames; i++) {
            double cf = Math.log(1 + 100.0 * (bf[i] + bf[i + 1]) / hop);
            double cl = Math.log(1 + 100.0 * (bl[i] + bl[i + 1]) / hop);
            o[i] = Math.max(0, cf - prevF) + Math.max(0, cl - prevL);
            prevF = cf;
            prevL = cl;
        }
        double mean = 0;
        for (double v : o) mean += v;
        mean /= frames;
        for (int i = 0; i < frames; i++) o[i] -= mean;
        return o;
    }

    private static double estimateTempo(double[] o, double hopSec) {
        int n = o.length;
        int minLag = (int) Math.floor(60.0 / (180.0 * hopSec));
        int maxLag = (int) Math.ceil(60.0 / (70.0 * hopSec));
        double[] r = new double[maxLag + 2];
        for (int lag = Math.max(1, minLag - 1); lag <= maxLag + 1 && lag < n; lag++) {
            double sum = 0;
            for (int i = 0; i + lag < n; i++) sum += o[i] * o[i + lag];
            r[lag] = sum / (n - lag);
        }
        double best = -1e18;
        int bestLag = minLag;
        for (int lag = minLag; lag <= maxLag; lag++) {
            double bpm = 60.0 / (lag * hopSec);
            double w = Math.exp(-0.5 * Math.pow(Math.log(bpm / 120.0) / Math.log(2) / 1.0, 2));
            double sc = r[lag] * w;
            if (sc > best) {
                best = sc;
                bestLag = lag;
            }
        }
        // afinar con interpolación parabólica
        double lagF = bestLag;
        double y0 = r[bestLag - 1];
        double y1 = r[bestLag];
        double y2 = r[bestLag + 1];
        double den = y0 - 2 * y1 + y2;
        if (den != 0) lagF += 0.5 * (y0 - y2) / den;
        double est = 60.0 / (lagF * hopSec);
        // Corrección de octava: si hay un pulso fuerte justo a la mitad del intervalo, el tempo real es el doble
        int half = (int) Math.round(lagF / 2);
        if (est < 90 && half >= minLag && half < r.length && r[half] >= 0.7 * r[bestLag]) est *= 2;
        return est;
    }

    /** Puntúa una rejilla de pulsos: devuelve {puntaje, fase en cuadros, z-score de la fase}. */
    private static double[] bestComb(double[] o, double periodFrames) {
        int frames = o.length;
        int phases = (int) Math.ceil(periodFrames * 2);
        double best = -1e18;
        double bestPhase = 0;
        double sum = 0;
        double sumSq = 0;
        for (int k = 0; k < phases; k++) {
            double p = k * 0.5;
            double s = 0;
            int cnt = 0;
            for (double t = p; t < frames - 1; t += periodFrames) {
                s += o[(int) Math.round(t)];
                cnt++;
            }
            if (cnt == 0) continue;
            s /= cnt;
            sum += s;
            sumSq += s * s;
            if (s > best) {
                best = s;
                bestPhase = p;
            }
        }
        double mean = sum / phases;
        double std = Math.sqrt(Math.max(1e-12, sumSq / phases - mean * mean));
        return new double[] { best, bestPhase, (best - mean) / std };
    }

    /**
     * Analiza una canción: BPM (de la etiqueta o calculado) y en qué milisegundo cae un pulso,
     * para que las animaciones latan a tiempo. Sin IA: solo procesamiento de señal.
     */
    @PluginMethod
    public void analyzeAudio(final PluginCall call) {
        final String uriStr = call.getString("uri");
        if (uriStr == null) {
            call.reject("Falta la uri");
            return;
        }
        analysisExecutor.execute(() -> {
            try {
                Uri uri = Uri.parse(uriStr);
                double tagBpm = readId3Bpm(uri);
                Pcm pcm = decodeMono(uri, 20_000_000L, 45_000_000L);

                final int hop = 512;
                double hopSec = (double) hop / pcm.sampleRate;
                double[] o = onsetEnvelope(pcm, hop);
                if (o == null) {
                    call.reject("Audio demasiado corto para analizar");
                    return;
                }

                double base = tagBpm > 0 ? tagBpm : estimateTempo(o, hopSec);
                double span = tagBpm > 0 ? 0.015 : 0.03;
                double bestBpm = base;
                double[] bestComb = null;
                for (double c = base * (1 - span); c <= base * (1 + span); c += 0.05) {
                    double[] comb = bestComb(o, 60.0 / (c * hopSec));
                    if (bestComb == null || comb[0] > bestComb[0]) {
                        bestComb = comb;
                        bestBpm = c;
                    }
                }
                if (bestComb == null) {
                    call.reject("No se pudo calcular el ritmo");
                    return;
                }
                double periodMs = 60000.0 / bestBpm;
                double beatSec = pcm.startSec + (bestComb[1] + 1.5) * hopSec;
                double offsetMs = (beatSec * 1000.0) % periodMs;

                JSObject res = new JSObject();
                res.put("bpm", Math.round(bestBpm * 100.0) / 100.0);
                res.put("offsetMs", Math.round(offsetMs));
                res.put("confidence", Math.round(bestComb[2] * 100.0) / 100.0);
                res.put("source", tagBpm > 0 ? "tag" : "analysis");
                call.resolve(res);
            } catch (Exception e) {
                call.reject("No se pudo analizar: " + e.getMessage());
            }
        });
    }

    /** Descarga una portada de internet y la deja lista en todos los tamaños. */
    @PluginMethod
    public void saveCoverFromUrl(final PluginCall call) {
        final long id = longArg(call, "id", 0L);
        final String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("URL inválida");
            return;
        }
        coverExecutor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(12000);
                conn.setRequestProperty("User-Agent", "LMusic/0.1");
                if (conn.getResponseCode() != 200) {
                    call.reject("El servidor respondió " + conn.getResponseCode());
                    return;
                }
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                int total = 0;
                try (InputStream in = conn.getInputStream()) {
                    while ((n = in.read(buf)) > 0) {
                        total += n;
                        if (total > 8 * 1024 * 1024) {
                            call.reject("Imagen demasiado grande");
                            return;
                        }
                        bos.write(buf, 0, n);
                    }
                }
                byte[] data = bos.toByteArray();

                File dir = new File(getContext().getFilesDir(), "covers");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                int[] sizes = { 160, 720, 2048 };
                boolean any = false;
                for (int size : sizes) {
                    Bitmap b = decodeScaled(data, size);
                    if (b == null) continue;
                    try (FileOutputStream fos = new FileOutputStream(new File(dir, id + "_" + size + ".jpg"))) {
                        b.compress(Bitmap.CompressFormat.JPEG, 90, fos);
                        any = true;
                    } finally {
                        b.recycle();
                    }
                }
                //noinspection ResultOfMethodCallIgnored
                new File(dir, id + ".none").delete();
                if (!any) {
                    call.reject("No se pudo leer la imagen");
                    return;
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("No se pudo descargar la portada: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /* Portada propia, bucle A-B y respaldo                                */
    /* ------------------------------------------------------------------ */

    private static boolean writeCoverSizes(byte[] data, File dir, long id) throws IOException {
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        boolean any = false;
        for (int size : new int[] { 160, 720, 2048 }) {
            Bitmap b = decodeScaled(data, size);
            if (b == null) continue;
            try (FileOutputStream fos = new FileOutputStream(new File(dir, id + "_" + size + ".jpg"))) {
                b.compress(Bitmap.CompressFormat.JPEG, 90, fos);
                any = true;
            } finally {
                b.recycle();
            }
        }
        return any;
    }

    /** Guarda una imagen elegida por el usuario como portada de una o varias canciones. */
    @PluginMethod
    public void saveCoverFromBase64(final PluginCall call) {
        final JSArray ids = call.getArray("ids");
        final String b64 = call.getString("data");
        if (ids == null || ids.length() == 0 || b64 == null) {
            call.reject("Faltan datos");
            return;
        }
        coverExecutor.execute(() -> {
            try {
                byte[] data = Base64.decode(b64, Base64.DEFAULT);
                File dir = new File(getContext().getFilesDir(), "covers");
                for (int i = 0; i < ids.length(); i++) {
                    long id = ids.getLong(i);
                    if (!writeCoverSizes(data, dir, id)) {
                        call.reject("No se pudo leer la imagen");
                        return;
                    }
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("No se pudo guardar la portada: " + e.getMessage());
            }
        });
    }

    /** Quita la portada propia para volver a la del archivo. */
    @PluginMethod
    public void removeCustomCover(final PluginCall call) {
        final JSArray ids = call.getArray("ids");
        if (ids == null) {
            call.reject("Faltan datos");
            return;
        }
        coverExecutor.execute(() -> {
            try {
                File dir = new File(getContext().getFilesDir(), "covers");
                for (int i = 0; i < ids.length(); i++) {
                    long id = ids.getLong(i);
                    for (int size : new int[] { 160, 720, 2048 }) {
                        //noinspection ResultOfMethodCallIgnored
                        new File(dir, id + "_" + size + ".jpg").delete();
                    }
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("No se pudo quitar la portada: " + e.getMessage());
            }
        });
    }

    /** Repite un tramo de la canción actual (bucle A-B o "repetir esta línea"). */
    @PluginMethod
    public void setLoop(final PluginCall call) {
        final long start = longArg(call, "startMs", 0L);
        final long end = longArg(call, "endMs", 0L);
        withController(call, c -> {
            main.removeCallbacks(loopTicker);
            if (end > start + 300) {
                loopStartMs = start;
                loopEndMs = end;
                c.seekTo(start);
                main.post(loopTicker);
            } else {
                loopEndMs = -1;
            }
            return null;
        });
    }

    @PluginMethod
    public void clearLoop(final PluginCall call) {
        withController(call, c -> {
            loopEndMs = -1;
            main.removeCallbacks(loopTicker);
            return null;
        });
    }

    /** Guarda el respaldo en Descargas/LMusic para que el usuario lo encuentre en el teléfono. */
    @PluginMethod
    public void saveBackup(final PluginCall call) {
        final String name = call.getString("name", "lmusic-respaldo.json");
        final String text = call.getString("text");
        if (text == null) {
            call.reject("Sin contenido");
            return;
        }
        coverExecutor.execute(() -> {
            try {
                byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
                JSObject res = new JSObject();
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentResolver resolver = getContext().getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/LMusic");
                    Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) {
                        call.reject("No se pudo crear el archivo");
                        return;
                    }
                    try (OutputStream os = resolver.openOutputStream(uri)) {
                        if (os == null) throw new IOException("Sin salida");
                        os.write(bytes);
                    }
                    res.put("path", "Descargas/LMusic/" + name);
                } else {
                    File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
                    if (dir == null) dir = getContext().getFilesDir();
                    File f = new File(dir, name);
                    try (FileOutputStream fos = new FileOutputStream(f)) {
                        fos.write(bytes);
                    }
                    res.put("path", f.getAbsolutePath());
                }
                call.resolve(res);
            } catch (Exception e) {
                call.reject("No se pudo guardar el respaldo: " + e.getMessage());
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /* Escribir etiquetas (ID3) en los archivos mp3, con copia del original */
    /* ------------------------------------------------------------------ */

    private File originalsDir() {
        File d = new File(getContext().getFilesDir(), "originals");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    /** Las copias de los originales se guardan 30 días. */
    private void cleanOldOriginals() {
        try {
            File[] files = originalsDir().listFiles();
            if (files == null) return;
            long limit = System.currentTimeMillis() - 30L * 24 * 3600 * 1000;
            for (File f : files) {
                if (f.lastModified() < limit) //noinspection ResultOfMethodCallIgnored
                    f.delete();
            }
        } catch (Exception ignored) {
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    private static byte[] syncsafe(int v) {
        return new byte[] { (byte) ((v >> 21) & 0x7f), (byte) ((v >> 14) & 0x7f), (byte) ((v >> 7) & 0x7f), (byte) (v & 0x7f) };
    }

    private static byte[] textFrame(String id, String value) {
        byte[] txt = value.getBytes(StandardCharsets.UTF_8);
        ByteArrayOutputStream d = new ByteArrayOutputStream();
        d.write(3); // codificación UTF-8 (válida en ID3v2.4)
        d.write(txt, 0, txt.length);
        return frame(id, d.toByteArray());
    }

    private static byte[] frame(String id, byte[] data) {
        ByteArrayOutputStream f = new ByteArrayOutputStream();
        byte[] idb = id.getBytes(StandardCharsets.ISO_8859_1);
        f.write(idb, 0, 4);
        byte[] sz = syncsafe(data.length);
        f.write(sz, 0, 4);
        f.write(0);
        f.write(0);
        f.write(data, 0, data.length);
        return f.toByteArray();
    }

    private static byte[] coverFrame(byte[] img) {
        String mime = (img.length > 3 && img[0] == (byte) 0x89 && img[1] == 'P') ? "image/png" : "image/jpeg";
        ByteArrayOutputStream d = new ByteArrayOutputStream();
        d.write(0); // ISO-8859-1 para el tipo MIME y la descripción
        byte[] m = mime.getBytes(StandardCharsets.ISO_8859_1);
        d.write(m, 0, m.length);
        d.write(0);
        d.write(3); // portada frontal
        d.write(0); // descripción vacía
        d.write(img, 0, img.length);
        return frame("APIC", d.toByteArray());
    }

    /**
     * Arma el archivo nuevo: etiqueta ID3v2.4 con los datos pedidos + los demás cuadros que ya tenía
     * (letras, número de disco…) + el audio original sin tocar.
     */
    private static byte[] rebuildMp3(byte[] src, String title, String artist, String album, String genre, int trackNo, byte[] cover) {
        int audioStart = 0;
        ArrayList<byte[]> kept = new ArrayList<>();
        if (src.length > 10 && src[0] == 'I' && src[1] == 'D' && src[2] == '3') {
            int ver = src[3];
            int flags = src[5] & 0xff;
            int size = synchsafeInt(src, 6);
            audioStart = 10 + size + ((flags & 0x10) != 0 ? 10 : 0);
            if (audioStart > src.length) audioStart = 0;
            int pos = 10;
            if ((flags & 0x40) != 0 && pos + 4 <= audioStart) {
                pos += ver == 4 ? synchsafeInt(src, pos) : be32Int(src, pos) + 4;
            }
            int end = 10 + size;
            while (ver >= 3 && pos + 10 <= end && pos + 10 <= src.length) {
                if (src[pos] == 0) break;
                String id = new String(src, pos, 4, StandardCharsets.ISO_8859_1);
                int fsize = ver == 4 ? synchsafeInt(src, pos + 4) : be32Int(src, pos + 4);
                int f0 = src[pos + 8] & 0xff;
                int f1 = src[pos + 9] & 0xff;
                if (fsize <= 0 || pos + 10 + fsize > end || pos + 10 + fsize > src.length) break;
                boolean replaced = id.equals("TIT2") || id.equals("TPE1") || id.equals("TALB") || id.equals("TCON")
                        || id.equals("TRCK") || (cover != null && id.equals("APIC"));
                boolean risky = ver == 4 ? (f1 & 0x4f) != 0 : (f1 & 0xe0) != 0;
                if (!replaced && !risky && id.matches("[A-Z0-9]{4}")) {
                    byte[] data = new byte[fsize];
                    System.arraycopy(src, pos + 10, data, 0, fsize);
                    kept.add(frame(id, data));
                }
                pos += 10 + fsize;
            }
        }
        ByteArrayOutputStream frames = new ByteArrayOutputStream();
        if (title != null && !title.isEmpty()) frames.write(textFrame("TIT2", title), 0, textFrame("TIT2", title).length);
        if (artist != null && !artist.isEmpty()) frames.write(textFrame("TPE1", artist), 0, textFrame("TPE1", artist).length);
        if (album != null && !album.isEmpty()) frames.write(textFrame("TALB", album), 0, textFrame("TALB", album).length);
        if (genre != null && !genre.isEmpty()) frames.write(textFrame("TCON", genre), 0, textFrame("TCON", genre).length);
        if (trackNo > 0) frames.write(textFrame("TRCK", String.valueOf(trackNo)), 0, textFrame("TRCK", String.valueOf(trackNo)).length);
        if (cover != null) {
            byte[] cf = coverFrame(cover);
            frames.write(cf, 0, cf.length);
        }
        for (byte[] k : kept) frames.write(k, 0, k.length);

        int padding = 512;
        int tagSize = frames.size() + padding;
        ByteArrayOutputStream out = new ByteArrayOutputStream(src.length - audioStart + tagSize + 10);
        out.write('I');
        out.write('D');
        out.write('3');
        out.write(4);
        out.write(0);
        out.write(0);
        byte[] ts = syncsafe(tagSize);
        out.write(ts, 0, 4);
        byte[] fb = frames.toByteArray();
        out.write(fb, 0, fb.length);
        out.write(new byte[padding], 0, padding);
        out.write(src, audioStart, src.length - audioStart);
        return out.toByteArray();
    }

    private static int synchsafeInt(byte[] b, int o) {
        return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
    }

    private static int be32Int(byte[] b, int o) {
        return ((b[o] & 0xff) << 24) | ((b[o + 1] & 0xff) << 16) | ((b[o + 2] & 0xff) << 8) | (b[o + 3] & 0xff);
    }

    /** Pide al sistema permiso para modificar estos archivos y luego ejecuta el trabajo. */
    private void askWriteAccess(final PluginCall call, final List<Uri> uris, final Runnable rawJob) {
        final Runnable job = () -> {
            try {
                rawJob.run();
            } catch (Throwable t) {
                // p. ej. falta de memoria: que no cierre la app, solo avisa
                call.reject("Se detuvo: " + (t.getMessage() != null ? t.getMessage() : t.getClass().getSimpleName()));
            }
        };
        if (Build.VERSION.SDK_INT < 30) {
            call.reject("Escribir en los archivos requiere Android 11 o superior.");
            return;
        }
        Boolean skip = call.getBoolean("skipPrompt", false);
        if (skip != null && skip) {
            fileExecutor.execute(job);
            return;
        }
        if (writeLauncher == null) {
            call.reject("No se pudo preparar el permiso de escritura.");
            return;
        }
        main.post(() -> {
            try {
                PendingIntent pi = MediaStore.createWriteRequest(getContext().getContentResolver(), uris);
                pendingWrite = job;
                pendingWriteCall = call;
                writeLauncher.launch(new IntentSenderRequest.Builder(pi.getIntentSender()).build());
            } catch (Exception e) {
                call.reject("No se pudo pedir el permiso: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void writeTags(final PluginCall call) {
        final JSArray items = call.getArray("items");
        if (items == null || items.length() == 0) {
            call.reject("No hay nada que escribir");
            return;
        }
        final ArrayList<Uri> uris = new ArrayList<>();
        try {
            for (int i = 0; i < items.length(); i++) uris.add(Uri.parse(items.getJSONObject(i).getString("uri")));
        } catch (JSONException e) {
            call.reject("Datos inválidos");
            return;
        }
        final Boolean keepObj = call.getBoolean("keepOriginal", true);
        final boolean keepOriginal = keepObj == null || keepObj;
        askWriteAccess(call, uris, () -> {
            ContentResolver resolver = getContext().getContentResolver();
            JSArray failed = new JSArray();
            int ok = 0;
            for (int i = 0; i < items.length(); i++) {
                long id = -1;
                try {
                    JSONObject it = items.getJSONObject(i);
                    id = it.getLong("id");
                    Uri uri = Uri.parse(it.getString("uri"));
                    byte[] cover = null;
                    String b64 = it.optString("coverBase64", "");
                    if (!b64.isEmpty()) cover = Base64.decode(b64, Base64.DEFAULT);

                    byte[] src;
                    try (InputStream in = resolver.openInputStream(uri)) {
                        if (in == null) throw new IOException("No se pudo abrir el archivo");
                        src = readAll(in);
                    }
                    if (src.length > 120 * 1024 * 1024) throw new IOException("Archivo demasiado grande");

                    // copia del original (una sola vez; se conserva 30 días). Si no se pide, se borra la que hubiera
                    File backup = new File(originalsDir(), id + ".orig");
                    if (keepOriginal) {
                        if (!backup.exists()) {
                            try (FileOutputStream fos = new FileOutputStream(backup)) {
                                fos.write(src);
                            }
                        }
                    } else if (backup.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        backup.delete();
                    }

                    byte[] out = rebuildMp3(src, it.optString("title"), it.optString("artist"), it.optString("album"),
                            it.optString("genre"), it.optInt("trackNo", 0), cover);
                    if (out.length < src.length / 2) throw new IOException("Resultado inesperado; no se modificó");

                    try (OutputStream os = resolver.openOutputStream(uri, "wt")) {
                        if (os == null) throw new IOException("No se pudo escribir");
                        os.write(out);
                    } catch (IOException werr) {
                        // si algo falla a mitad de camino, se devuelve el original
                        try (OutputStream os = resolver.openOutputStream(uri, "wt")) {
                            if (os != null) os.write(src);
                        } catch (IOException ignored) {
                        }
                        throw werr;
                    }

                    try {
                        ContentValues v = new ContentValues();
                        if (!it.optString("title").isEmpty()) v.put(MediaStore.Audio.Media.TITLE, it.optString("title"));
                        if (!it.optString("artist").isEmpty()) v.put(MediaStore.Audio.Media.ARTIST, it.optString("artist"));
                        if (!it.optString("album").isEmpty()) v.put(MediaStore.Audio.Media.ALBUM, it.optString("album"));
                        if (v.size() > 0) resolver.update(uri, v, null, null);
                    } catch (Exception ignored) {
                        // el sistema lo actualizará en el próximo escaneo
                    }
                    ok++;
                } catch (Throwable e) {
                    JSObject f = new JSObject();
                    f.put("id", id);
                    f.put("message", e instanceof OutOfMemoryError ? "Sin memoria para este archivo" : (e.getMessage() != null ? e.getMessage() : "Error"));
                    failed.put(f);
                }
            }
            JSObject res = new JSObject();
            res.put("ok", ok);
            res.put("failed", failed);
            call.resolve(res);
        });
    }

    /** Devuelve los archivos a como estaban antes de escribirles etiquetas (si la copia sigue guardada). */
    @PluginMethod
    public void restoreOriginals(final PluginCall call) {
        final JSArray items = call.getArray("items");
        if (items == null || items.length() == 0) {
            call.reject("No hay nada que restaurar");
            return;
        }
        final ArrayList<Uri> uris = new ArrayList<>();
        try {
            for (int i = 0; i < items.length(); i++) uris.add(Uri.parse(items.getJSONObject(i).getString("uri")));
        } catch (JSONException e) {
            call.reject("Datos inválidos");
            return;
        }
        askWriteAccess(call, uris, () -> {
            ContentResolver resolver = getContext().getContentResolver();
            JSArray failed = new JSArray();
            int ok = 0;
            for (int i = 0; i < items.length(); i++) {
                long id = -1;
                try {
                    JSONObject it = items.getJSONObject(i);
                    id = it.getLong("id");
                    File backup = new File(originalsDir(), id + ".orig");
                    if (!backup.exists()) throw new IOException("No hay copia del original (pasaron más de 30 días)");
                    byte[] data;
                    try (InputStream in = new java.io.FileInputStream(backup)) {
                        data = readAll(in);
                    }
                    try (OutputStream os = resolver.openOutputStream(Uri.parse(it.getString("uri")), "wt")) {
                        if (os == null) throw new IOException("No se pudo escribir");
                        os.write(data);
                    }
                    //noinspection ResultOfMethodCallIgnored
                    backup.delete();
                    ok++;
                } catch (Throwable e) {
                    JSObject f = new JSObject();
                    f.put("id", id);
                    f.put("message", e instanceof OutOfMemoryError ? "Sin memoria para este archivo" : (e.getMessage() != null ? e.getMessage() : "Error"));
                    failed.put(f);
                }
            }
            JSObject res = new JSObject();
            res.put("ok", ok);
            res.put("failed", failed);
            call.resolve(res);
        });
    }

    /** ¿Ya tenemos permiso de escritura sobre todos estos archivos? (por un permiso pedido antes) */
    private boolean hasWriteAccess(List<Uri> uris) {
        if (uris == null || uris.isEmpty()) return false;
        try {
            for (Uri u : uris) {
                if (getContext().checkCallingOrSelfUriPermission(u, android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                        != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    return false;
                }
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Pide el permiso del sistema UNA sola vez para todos estos archivos (luego writeTags con skipPrompt no vuelve a preguntar). */
    @PluginMethod
    public void grantWrite(final PluginCall call) {
        final JSArray items = call.getArray("items");
        if (items == null || items.length() == 0) {
            call.reject("No hay nada que escribir");
            return;
        }
        final ArrayList<Uri> uris = new ArrayList<>();
        try {
            for (int i = 0; i < items.length(); i++) uris.add(Uri.parse(items.getJSONObject(i).getString("uri")));
        } catch (JSONException e) {
            call.reject("Datos inválidos");
            return;
        }
        final int count = uris.size();
        askWriteAccess(call, uris, () -> {
            JSObject res = new JSObject();
            res.put("ok", count);
            call.resolve(res);
        });
    }

    /** Borra archivos del teléfono. Android muestra su propio aviso de confirmación (Android 11 o superior). */
    @PluginMethod
    public void deleteTracks(final PluginCall call) {
        final JSArray items = call.getArray("items");
        if (items == null || items.length() == 0) {
            call.reject("No hay nada que eliminar");
            return;
        }
        final ArrayList<Uri> uris = new ArrayList<>();
        try {
            for (int i = 0; i < items.length(); i++) uris.add(Uri.parse(items.getJSONObject(i).getString("uri")));
        } catch (JSONException e) {
            call.reject("Datos inválidos");
            return;
        }
        if (Build.VERSION.SDK_INT < 30) {
            call.reject("Eliminar archivos requiere Android 11 o superior.");
            return;
        }
        if (writeLauncher == null) {
            call.reject("No se pudo preparar el permiso del sistema.");
            return;
        }
        final int count = uris.size();
        main.post(() -> {
            try {
                PendingIntent pi = MediaStore.createDeleteRequest(getContext().getContentResolver(), uris);
                // si el usuario acepta, el sistema ya borró los archivos: solo avisamos a la app
                pendingWrite = () -> {
                    JSObject res = new JSObject();
                    res.put("ok", count);
                    call.resolve(res);
                };
                pendingWriteCall = call;
                writeLauncher.launch(new IntentSenderRequest.Builder(pi.getIntentSender()).build());
            } catch (Exception e) {
                call.reject("No se pudo pedir la confirmación: " + e.getMessage());
            }
        });
    }

    /** Cambia de lugar una canción de la cola sin cortar la reproducción. */
    @PluginMethod
    public void moveQueueItem(PluginCall call) {
        final int from = call.getInt("from", -1);
        final int to = call.getInt("to", -1);
        withController(call, c -> {
            int n = c.getMediaItemCount();
            if (from >= 0 && to >= 0 && from < n && to < n && from != to) c.moveMediaItem(from, to);
            return null;
        });
    }

    /** Borra todas las copias de originales guardadas por la app para liberar espacio. */
    @PluginMethod
    public void clearOriginals(final PluginCall call) {
        fileExecutor.execute(() -> {
            long freed = 0;
            int count = 0;
            try {
                File[] files = originalsDir().listFiles();
                if (files != null) {
                    for (File f : files) {
                        long size = f.length();
                        if (f.delete()) {
                            freed += size;
                            count++;
                        }
                    }
                }
            } catch (Exception ignored) {
            }
            JSObject res = new JSObject();
            res.put("files", count);
            res.put("freedBytes", freed);
            call.resolve(res);
        });
    }

    /**
     * Volumen de la canción en tramos de 5 s. Sirve para sugerir el momento más intenso (el coro o el clímax).
     * Solo procesamiento de señal, sin IA.
     */
    @PluginMethod
    public void analyzeEnergy(final PluginCall call) {
        final String uriStr = call.getString("uri");
        final Integer durObj = call.getInt("durationMs", 0);
        final int durationMs = durObj == null ? 0 : durObj;
        if (uriStr == null || durationMs < 20000) {
            call.reject("La canción es muy corta o faltan datos");
            return;
        }
        analysisExecutor.execute(() -> {
            try {
                Uri uri = Uri.parse(uriStr);
                final long stepUs = 5_000_000L;
                int n = (int) ((durationMs * 1000L) / stepUs);
                JSArray vals = new JSArray();
                for (int k = 0; k < n; k++) {
                    double v = 0;
                    try {
                        Pcm p = decodeMono(uri, k * stepUs, stepUs);
                        // si el tramo no empezó donde se pidió (el último), se ignora
                        if (Math.abs(p.startSec - k * 5.0) < 2.0 && p.length > p.sampleRate / 2) {
                            double sum = 0;
                            for (int i = 0; i < p.length; i++) {
                                double x = p.data[i] / 32768.0;
                                sum += x * x;
                            }
                            v = Math.sqrt(sum / p.length);
                        }
                    } catch (Exception ignored) {
                    }
                    vals.put(Math.round(v * 10000.0) / 10000.0);
                    if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
                }
                JSObject res = new JSObject();
                res.put("stepMs", 5000);
                res.put("values", vals);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("No se pudo analizar: " + e.getMessage());
            }
        });
    }
}
