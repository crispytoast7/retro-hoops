package app.retrohoops.game;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The game is laid out to the pixel: the phone's font-size setting must not stretch it.
        // (Settings > Text size inside the game is the way to make menus larger.)
        getBridge().getWebView().getSettings().setTextZoom(100);
        getBridge().getWebView().setOverScrollMode(android.view.View.OVER_SCROLL_NEVER);
    }
}
