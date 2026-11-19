package com.lmusic.app;

import android.app.PendingIntent;
import android.content.Intent;

import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

/**
 * Servicio que mantiene la música sonando con la pantalla apagada.
 * Media3 crea la notificación y los controles de la pantalla de bloqueo automáticamente.
 */
public class PlaybackService extends MediaSessionService {

    private MediaSession session;

    @Override
    public void onCreate() {
        super.onCreate();

        // Muchos mp3 (p. ej. los convertidos de YouTube) no traen tabla de búsqueda: sin esto,
        // adelantar o tocar la letra los reinicia desde el principio. Con esto el salto es aproximado.
        DefaultExtractorsFactory extractors = new DefaultExtractorsFactory().setConstantBitrateSeekingEnabled(true);

        ExoPlayer player = new ExoPlayer.Builder(this, new DefaultMediaSourceFactory(this, extractors))
                .setAudioAttributes(
                        new AudioAttributes.Builder()
                                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                                .setUsage(C.USAGE_MEDIA)
                                .build(),
                        /* handleAudioFocus= */ true)
                .setHandleAudioBecomingNoisy(true) // pausa al desconectar los audífonos
                .build();

        MediaSession.Builder builder = new MediaSession.Builder(this, player);

        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            PendingIntent pi = PendingIntent.getActivity(
                    this, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            builder.setSessionActivity(pi);
        }
        session = builder.build();
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        // Si el usuario cierra la app desde recientes y no hay música sonando, apagar el servicio.
        if (session != null) {
            Player p = session.getPlayer();
            if (!p.getPlayWhenReady() || p.getMediaItemCount() == 0) {
                stopSelf();
            }
        }
    }

    @Override
    public void onDestroy() {
        if (session != null) {
            session.getPlayer().release();
            session.release();
            session = null;
        }
        super.onDestroy();
    }
}
