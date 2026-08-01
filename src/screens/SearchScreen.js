import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import TrackRow from "../components/TrackRow";
import { addToPlaylist, createPlaylist } from "../data/db";
import { usePlayer } from "../player/PlayerContext";
import { fetchPlaylist, searchTracks } from "../services/piped";
import { colors } from "../theme";

export default function SearchScreen() {
  const player = usePlayer();
  const [q, setQ] = useState("");
  const [url, setUrl] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);

  const run = async () => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setResults(await searchTracks(q.trim()));
    } catch (e) {
      setError(e.message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const importPlaylist = async () => {
    if (!url.trim()) return;
    setImporting(true);
    try {
      const pl = await fetchPlaylist(url.trim());
      const id = await createPlaylist(pl.name);
      if (id) for (const item of pl.items) await addToPlaylist(id, item);
      Alert.alert(
        "Importation terminée",
        `${pl.items.length} titres ajoutés à « ${pl.name} ».`
      );
      setUrl("");
    } catch (e) {
      Alert.alert("Échec de l'import", e.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.h1}>Rechercher</Text>

        <View style={styles.field}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            onSubmitEditing={run}
            returnKeyType="search"
            placeholder="Titres, artistes…"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
        </View>

        <View style={styles.field}>
          <Ionicons name="link" size={18} color={colors.textMuted} />
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="URL de playlist YouTube à importer"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            style={styles.input}
          />
          <TouchableOpacity onPress={importPlaylist} disabled={importing}>
            {importing ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={styles.action}>Importer</Text>
            )}
          </TouchableOpacity>
        </View>

        {!!error && <Text style={styles.error}>{error}</Text>}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TrackRow
              track={item}
              active={player.current?.id === item.id}
              onPress={() => player.playTrack(item, results)}
            />
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              Cherchez un titre — flux audio seul, environ 2 Mo par chanson.
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16, gap: 12 },
  h1: { color: colors.text, fontSize: 26, fontWeight: "800", marginVertical: 12 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.elevated,
    borderRadius: 6,
    paddingHorizontal: 12,
    height: 46,
  },
  input: { flex: 1, color: colors.text, fontSize: 14 },
  action: { color: colors.accent, fontWeight: "700", fontSize: 12 },
  error: { color: colors.danger, fontSize: 12 },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  empty: { color: colors.textMuted, fontSize: 13, textAlign: "center", marginTop: 40 },
});
