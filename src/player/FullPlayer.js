import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { fmt } from "../components/TrackRow";
import { addFavorite, isFavorite, removeFavorite } from "../data/db";
import { downloadTrack } from "../services/downloads";
import { colors } from "../theme";
import { usePlayer } from "./PlayerContext";

export default function FullPlayer() {
  const p = usePlayer();
  const [fav, setFav] = useState(false);
  const [dl, setDl] = useState("idle");

  useEffect(() => {
    if (p?.current) isFavorite(p.current.id).then(setFav);
    setDl("idle");
  }, [p?.current?.id]);

  if (!p?.current) return null;
  const pct = p.duration ? (p.position / p.duration) * 100 : 0;

  const toggleFav = async () => {
    if (fav) await removeFavorite(p.current.id);
    else await addFavorite(p.current);
    setFav(!fav);
  };

  const doDownload = async () => {
    setDl("busy");
    try {
      await downloadTrack(p.current);
      setDl("done");
    } catch {
      setDl("error");
    }
  };

  const repeatIcon =
    p.repeat === "one" ? "repeat-outline" : "repeat";

  return (
    <Modal
      visible={p.expanded}
      animationType="slide"
      onRequestClose={() => p.setExpanded(false)}
    >
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => p.setExpanded(false)} hitSlop={12}>
            <Ionicons name="chevron-down" size={28} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerLabel}>En lecture</Text>
          <TouchableOpacity onPress={doDownload} hitSlop={12}>
            <Ionicons
              name={dl === "done" ? "checkmark-circle" : "arrow-down-circle-outline"}
              size={26}
              color={dl === "done" ? colors.accent : colors.text}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.artWrap}>
          <Image source={{ uri: p.current.thumbnail }} style={styles.art} />
        </View>

        <View style={styles.info}>
          <Text numberOfLines={2} style={styles.title}>
            {p.current.title}
          </Text>
          <Text numberOfLines={1} style={styles.author}>
            {p.current.author}
          </Text>
          {!!p.bitrate && (
            <Text style={styles.badge}>
              Flux audio {Math.round(p.bitrate / 1000)} kbps · mode économie
            </Text>
          )}
          {!!p.error && <Text style={styles.error}>{p.error}</Text>}
        </View>

        <Pressable
          style={styles.trackBar}
          onPress={(e) => {
            const w = e.nativeEvent.locationX;
            p.seek((w / 320) * p.duration);
          }}
        >
          <View style={styles.trackBg}>
            <View style={[styles.trackFill, { width: `${pct}%` }]} />
          </View>
        </Pressable>
        <View style={styles.times}>
          <Text style={styles.time}>{fmt(p.position / 1000)}</Text>
          <Text style={styles.time}>{fmt(p.duration / 1000)}</Text>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity onPress={toggleFav} hitSlop={12}>
            <Ionicons
              name={fav ? "heart" : "heart-outline"}
              size={26}
              color={fav ? colors.accent : colors.textMuted}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={p.prev} hitSlop={12}>
            <Ionicons name="play-skip-back" size={34} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={p.toggle} style={styles.playBtn}>
            {p.loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Ionicons
                name={p.isPlaying ? "pause" : "play"}
                size={32}
                color="#000"
              />
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={p.next} hitSlop={12}>
            <Ionicons name="play-skip-forward" size={34} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={p.cycleRepeat} hitSlop={12}>
            <Ionicons
              name={repeatIcon}
              size={24}
              color={p.repeat === "off" ? colors.textMuted : colors.accent}
            />
          </TouchableOpacity>
        </View>
        <Text style={styles.repeatLabel}>
          {p.repeat === "off"
            ? "Répétition désactivée"
            : p.repeat === "all"
              ? "Répéter la file"
              : "Répéter le titre"}
        </Text>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: 20 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  headerLabel: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  artWrap: { alignItems: "center", marginTop: 24 },
  art: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 8,
    backgroundColor: colors.elevated,
  },
  info: { marginTop: 28 },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  author: { color: colors.textMuted, fontSize: 14, marginTop: 4 },
  badge: { color: colors.accent, fontSize: 11, marginTop: 8 },
  error: { color: colors.danger, fontSize: 12, marginTop: 8 },
  trackBar: { marginTop: 28 },
  trackBg: { height: 4, borderRadius: 2, backgroundColor: colors.border },
  trackFill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  times: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  time: { color: colors.textMuted, fontSize: 11 },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 24,
  },
  playBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  repeatLabel: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: "center",
    marginTop: 16,
  },
});
