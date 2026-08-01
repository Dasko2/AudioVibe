import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import MiniPlayer from "./src/components/MiniPlayer";
import { initDb } from "./src/data/db";
import FullPlayer from "./src/player/FullPlayer";
import { PlayerProvider } from "./src/player/PlayerContext";
import HomeScreen from "./src/screens/HomeScreen";
import LibraryScreen from "./src/screens/LibraryScreen";
import SearchScreen from "./src/screens/SearchScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import { loadPreferredInstance } from "./src/services/piped";
import { SettingsProvider } from "./src/services/settings";
import { colors } from "./src/theme";

const Tab = createBottomTabNavigator();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    primary: colors.accent,
    border: "transparent",
  },
};

const icons = {
  Accueil: ["home", "home-outline"],
  Recherche: ["search", "search-outline"],
  Bibliothèque: ["library", "library-outline"],
  Réglages: ["settings", "settings-outline"],
};

export default function App() {
  // CRITICAL: never block the first render on initialization.
  // The UI mounts immediately; DB/instance bootstrapping runs in the background
  // and surfaces a warning banner instead of a frozen splash screen.
  const [dbWarning, setDbWarning] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await initDb();
        if (!cancelled && !res.ok) setDbWarning(res.error || "erreur inconnue");
      } catch (e) {
        if (!cancelled) setDbWarning(e?.message || "erreur inconnue");
      }
      loadPreferredInstance().catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SettingsProvider>
        <PlayerProvider>
          <NavigationContainer theme={theme}>
            <View style={styles.root}>
              <Tab.Navigator
                screenOptions={({ route }) => ({
                  headerShown: false,
                  tabBarActiveTintColor: colors.text,
                  tabBarInactiveTintColor: colors.textMuted,
                  tabBarStyle: styles.tabBar,
                  tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
                  tabBarIcon: ({ focused, color, size }) => {
                    const [on, off] = icons[route.name] || ["disc", "disc-outline"];
                    return (
                      <Ionicons
                        name={focused ? on : off}
                        size={size - 2}
                        color={color}
                      />
                    );
                  },
                })}
                tabBar={undefined}
              >
                <Tab.Screen name="Accueil">
                  {() => <HomeScreen dbWarning={dbWarning} />}
                </Tab.Screen>
                <Tab.Screen name="Recherche" component={SearchScreen} />
                <Tab.Screen name="Bibliothèque" component={LibraryScreen} />
                <Tab.Screen name="Réglages" component={SettingsScreen} />
              </Tab.Navigator>
              <View style={styles.mini} pointerEvents="box-none">
                <MiniPlayer />
              </View>
              <FullPlayer />
            </View>
          </NavigationContainer>
        </PlayerProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  tabBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 0,
    height: 62,
    paddingBottom: 8,
    paddingTop: 6,
  },
  mini: { position: "absolute", left: 0, right: 0, bottom: 62 },
});
