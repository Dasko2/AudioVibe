import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import TrackRow from "../components/TrackRow";
import {
  createPlaylist,
  deletePlaylist,
  listDownloads,
  listFavorites,
  listPlaylistItems,
  listPlaylists,
  removePlaylistItem,
} from "../data/db";
import { usePlayer } from "../player/PlayerContext";
import { deleteDownload, mb } from "../services/downloads";
import { colors } from "../theme";

const toTrack = (r) => ({
  id: r.video_id || r.id,
  title: r.title,
  author: r.author,
  thumbnail: r.thumbnail,
  duration: r.duration,
});

export default function LibraryScreen() {
  const player = usePlayer();
  const [tab, setTab] = useState("playlists");
  const [playlists, setPlaylists] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [downloads, setDownloads] = useState([]);
  const [open, setOpen] = useState(null);
  const [items, setItems] = useState([]);
  const [newName, setNewName] = useState("");

  const refresh = useCallback(() => {
    listPlaylists().then((r) => setPlaylists(r || []));
    listFavorites().then((r) => setFavorites(r || []));
    listDownloads().then((r) => setDownloads(r || []));
  }, []);

  useFocusEffect(useCallback(() => refresh(), [refresh]));

  const openPlaylist = async (p) => {
    setOpen(p);
    setItems((await listPlaylistItems(p.id)) || []);
  };

  const create = async () => {
    if (!newName.trim()) return;
    await createPlaylist(newName.trim());
    setNewName("");
    refresh();
  };

  const confirmDelete = (p) =>
    Alert.alert("Supprimer", `Supprimer « ${p.name} » ?`, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer",
        style: "destructive",
        onPress: async () => {
          await deletePlaylist(p.id);
          refresh();
        },
      },
    ]);

  const tabs = [
    ["playlists", "Playlists"],
    ["favorites", "Favoris"],
    ["downloads", "Hors-ligne"],
  ];

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Text style={styles.h1}>Bibliothèque</Text>
      <View style={styles.tabs}>
        {tabs.map(([k, label]) => (
          <TouchableOpacity
            key={k}
            onPress={() => setTab(k)}
            style={[styles.tab, tab === k && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === k && styles.tabTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === "playlists" && (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.field}>
            <Ionicons name="add" size={18} color={colors.textMuted} />
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="Nouvelle playlist"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              onSubmitEditing={create}
            />
            <TouchableOpacity onPress={create}>
              <Text style={styles.action}>Créer</Text>
            </TouchableOpacity>
          </View>
          {playlists.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={styles.plRow}
              onPress={() => openPlaylist(p)}
              onLongPress={() => confirmDelete(p)}
            >
              <View style={styles.plArt}>
                <Ionicons name="musical-notes" size={22} color={colors.textMuted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.plName}>{p.name}</Text>
                <Text style={styles.plSub}>{p.count} titres</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
          {!playlists.length && (
            <Text style={styles.empty}>
              Aucune playlist. Importez une URL YouTube depuis l'onglet Recherche.
            </Text>
          )}
        </ScrollView>
      )}

      {tab === "favorites" && (
        <FlatList
          data={favorites}
          keyExtractor={(i) => i.video_id}
          contentContainerStyle={styles.content}
          renderItem={({ item }) => (
            <TrackRow
              track={toTrack(item)}
              active={player.current?.id === item.video_id}
              onPress={() =>
                player.playTrack(toTrack(item), favorites.map(toTrack))
              }
            />
          )}
          ListEmptyComponent={<Text style={styles.empty}>Aucun favori.</Text>}
        />
      )}

      {tab === "downloads" && (
        <FlatList
          data={downloads}
          keyExtractor={(i) => i.video_id}
          contentContainerStyle={styles.content}
          renderItem={({ item }) => (
            <TrackRow
              track={toTrack(item)}
              active={player.current?.id === item.video_id}
              onPress={() =>
                player.playTrack(toTrack(item), downloads.map(toTrack))
              }
              right={
                <TouchableOpacity
                  onPress={async () => {
                    await deleteDownload(item.video_id);
                    refresh();
                  }}
                >
                  <Text style={styles.size}>{mb(item.bytes)} ✕</Text>
                </TouchableOpacity>
              }
            />
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              Aucun téléchargement. Ouvrez le lecteur plein écran et touchez l'icône
              de téléchargement.
            </Text>
          }
        />
      )}

      <Modal visible={!!open} animationType="slide" onRequestClose={() => setOpen(null)}>
        <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setOpen(null)} hitSlop={12}>
              <Ionicons name="chevron-down" size={26} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.plName}>{open?.name}</Text>
            <View style={{ width: 26 }} />
          </View>
          <FlatList
            data={items}
            keyExtractor={(i) => String(i.id)}
            contentContainerStyle={styles.content}
            renderItem={({ item }) => (
              <TrackRow
                track={toTrack(item)}
                onPress={() => {
                  player.playTrack(toTrack(item), items.map(toTrack));
                  setOpen(null);
                }}
                right={
                  <TouchableOpacity
                    onPress={async () => {
                      await removePlaylistItem(item.id);
                      setItems((await listPlaylistItems(open.id)) || []);
                    }}
                  >
                    <Ionicons name="close" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                }
              />
            )}
            ListEmptyComponent={<Text style={styles.empty}>Playlist vide.</Text>}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  h1: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "800",
    paddingHorizontal: 16,
    marginVertical: 12,
  },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.elevated,
  },
  tabActive: { backgroundColor: colors.accent },
  tabText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  tabTextActive: { color: "#000" },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.elevated,
    borderRadius: 6,
    paddingHorizontal: 12,
    height: 46,
    marginBottom: 12,
  },
  input: { flex: 1, color: colors.text, fontSize: 14 },
  action: { color: colors.accent, fontWeight: "700", fontSize: 12 },
  plRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  plArt: {
    width: 52,
    height: 52,
    borderRadius: 4,
    backgroundColor: colors.elevated,
    alignItems: "center",
    justifyContent: "center",
  },
  plName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  plSub: { color: colors.textMuted, fontSize: 12 },
  empty: { color: colors.textMuted, fontSize: 13, textAlign: "center", marginTop: 40 },
  size: { color: colors.textMuted, fontSize: 11 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
});
