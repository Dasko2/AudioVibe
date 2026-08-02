import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { usePlayer } from "../player/PlayerContext";
import { colors } from "../theme";

export default function MiniPlayer() {
  const p = usePlayer();
  const visible = !!p?.current;

  const slide = useRef(new Animated.Value(0)).current; // 0 caché, 1 visible
  const scale = useRef(new Animated.Value(1)).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(slide, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      damping: 18,
      stiffness: 160,
      mass: 0.9,
    }).start();
  }, [visible, slide]);

  const pct = p?.duration ? p.position / p.duration : 0;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: pct,
      duration: 550,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [pct, progress]);

  if (!visible) return null;

  const press = (to) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      damping: 14,
      stiffness: 220,
    }).start();

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          opacity: slide,
          transform: [
            {
              translateY: slide.interpolate({
                inputRange: [0, 1],
                outputRange: [70, 0],
              }),
            },
            { scale },
          ],
        },
      ]}
    >
      <Pressable
        style={styles.bar}
        onPressIn={() => press(0.97)}
        onPressOut={() => press(1)}
        onPress={() => p.setExpanded(true)}
      >
        <Image source={{ uri: p.current.thumbnail }} style={styles.art} />
        <View style={styles.meta}>
          <Text numberOfLines={1} style={styles.title}>
            {p.current.title}
          </Text>
          <Text numberOfLines={1} style={styles.author}>
            {p.error ? p.error : p.current.author}
          </Text>
        </View>
        <TouchableOpacity
          onPress={p.toggle}
          hitSlop={12}
          activeOpacity={0.6}
          style={styles.btn}
        >
          {p.loading ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Ionicons
              name={p.isPlaying ? "pause" : "play"}
              size={24}
              color={colors.text}
            />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={p.next}
          hitSlop={12}
          activeOpacity={0.6}
          style={styles.btn}
        >
          <Ionicons name="play-skip-forward" size={20} color={colors.text} />
        </TouchableOpacity>
      </Pressable>
      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            {
              width: progress.interpolate({
                inputRange: [0, 1],
                outputRange: ["0%", "100%"],
              }),
            },
          ]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.surfaceAlt },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 10,
  },
  art: { width: 40, height: 40, borderRadius: 4, backgroundColor: colors.elevated },
  meta: { flex: 1 },
  title: { color: colors.text, fontSize: 13, fontWeight: "600" },
  author: { color: colors.textMuted, fontSize: 11 },
  btn: { padding: 6 },
  track: { height: 2, backgroundColor: colors.border },
  fill: { height: 2, backgroundColor: colors.accent },
});
