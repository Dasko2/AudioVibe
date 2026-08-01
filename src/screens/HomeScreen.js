import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import TrackRow from "../components/TrackRow";
import { listFavorites, listHistory } from "../data/db";
import { usePlayer } from "../player/PlayerContext";
import { trending } from "../services/piped";
import { useSettings } from "../services/settings";
import logo from "../../assets/logo.png";
import { colors } from "../theme";

export default function HomeScreen({ dbWarning }) {
  const { settings } = useSettings();
  const player = usePlayer();
  const [history, setHistory] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [hits, setHits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [netError, setNetError] = useState(null);

  const load = useCallback(async () => {
    listHistory(10).then((r) => setHistory(r || []));
    listFavorites().then((r) => setFavorites(r || []));
    setLoading(true);
    try {
      const t = await trending(settings.region);
      setHits(t.slice(0, 20));
      setNetError(null);
    } catch (e) {
      setNetError(e.message);
    } finally {
      setLoading(false);
    }
  }, [settings.region]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toTrack = (r) => ({
    id: r.video_id || r.id,
    title: r.title,
    author: r.author,
    thumbnail: r.thumbnail,
    duration: r.duration,
  });

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />
        }
      >
        <View style={styles.brand}>
          <Image source={logo} style={styles.brandLogo} resizeMode="contain" />
          <View>
            <Text style={styles.brandName}>AudioVibe</Text>
            <Text style={styles.brandTag}>Bonsoir</Text>
          </View>
        </View>


        {!!dbWarning && (
          <View style={styles.warn}>
            <Text style={styles.warnText}>
              Stockage local indisponible ({dbWarning}) — la lecture fonctionne, mais
              rien n'est sauvegardé.
            </Text>
          </View>
        )}
        {!!netError && (
          <View style={styles.warn}>
            <Text style={styles.warnText}>{netError}</Text>
          </View>
        )}

        {history.length > 0 && (
          <>
            <View style={styles.grid}>
              {history.slice(0, 6).map((h) => (
                <TouchableOpacity
                  key={h.id}
                  style={styles.chip}
                  onPress={() =>
                    player.playTrack(toTrack(h), history.map(toTrack))
                  }
                >
                  <Image source={{ uri: h.thumbnail }} style={styles.chipArt} />
                  <Text numberOfLines={2} style={styles.chipText}>
                    {h.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {favorites.length > 0 && (
          <>
            <Text style={styles.section}>Vos favoris</Text>
            <FlatList
              horizontal
              data={favorites}
              keyExtractor={(i) => i.video_id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 14 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.card}
                  onPress={() =>
                    player.playTrack(toTrack(item), favorites.map(toTrack))
                  }
                >
                  <Image source={{ uri: item.thumbnail }} style={styles.cardArt} />
                  <Text numberOfLines={2} style={styles.cardTitle}>
                    {item.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.cardSub}>
                    {item.author}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </>
        )}

        <Text style={styles.section}>Tendances</Text>
        {loading && !hits.length ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} />
        ) : (
          hits.map((t) => (
            <TrackRow
              key={t.id}
              track={t}
              active={player.current?.id === t.id}
              onPress={() => player.playTrack(t, hits)}
            />
          ))
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  brand: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 16 },
  brandLogo: { width: 44, height: 44, borderRadius: 12 },
  brandName: { color: colors.text, fontSize: 22, fontWeight: "800" },
  brandTag: { color: colors.textMuted, fontSize: 12 },
  warn: {
    backgroundColor: "#3A2A00",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  warnText: { color: "#FFD479", fontSize: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    width: "48%",
    backgroundColor: colors.elevated,
    borderRadius: 4,
    overflow: "hidden",
  },
  chipArt: { width: 48, height: 48 },
  chipText: { color: colors.text, fontSize: 12, fontWeight: "600", flex: 1, padding: 6 },
  section: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    marginTop: 28,
    marginBottom: 12,
  },
  card: { width: 140 },
  cardArt: {
    width: 140,
    height: 140,
    borderRadius: 6,
    backgroundColor: colors.elevated,
  },
  cardTitle: { color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 8 },
  cardSub: { color: colors.textMuted, fontSize: 11 },
});
