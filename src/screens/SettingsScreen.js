import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  clearHistory,
  exportLibrary,
  getProfile,
  importLibrary,
  setProfileName,
} from "../data/db";
import { INSTANCES, setPreferredInstance } from "../services/piped";
import { useSettings } from "../services/settings";
import logo from "../../assets/logo.png";
import { colors } from "../theme";

function Row({ label, hint, children }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {!!hint && <Text style={styles.rowHint}>{hint}</Text>}
      </View>
      {children}
    </View>
  );
}

export default function SettingsScreen() {
  const { settings, update } = useSettings();
  const [name, setName] = useState("");

  useEffect(() => {
    getProfile().then((p) => setName(p?.name || "Auditeur"));
  }, []);

  const doExport = async () => {
    try {
      const data = await exportLibrary();
      const uri = FileSystem.documentDirectory + "audiovibe-export.json";
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(data, null, 2));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
      else Alert.alert("Export", "Fichier enregistré : " + uri);
    } catch (e) {
      Alert.alert("Export impossible", e.message);
    }
  };

  const doImport = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "application/json" });
      if (res.canceled) return;
      const raw = await FileSystem.readAsStringAsync(res.assets[0].uri);
      const n = await importLibrary(JSON.parse(raw));
      Alert.alert("Import terminé", `${n} playlist(s) importée(s).`);
    } catch (e) {
      Alert.alert("Import impossible", e.message);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.h1}>Paramètres</Text>

        <Text style={styles.section}>Profil (local)</Text>
        <View style={styles.field}>
          <Ionicons name="person" size={18} color={colors.textMuted} />
          <TextInput
            value={name}
            onChangeText={setName}
            onEndEditing={() => setProfileName(name)}
            style={styles.input}
            placeholderTextColor={colors.textMuted}
          />
        </View>

        <Text style={styles.section}>Données</Text>
        <Row
          label="Mode économie ultra"
          hint="Flux Opus/WebM le plus bas (~64-96 kbps) · ~2 Mo par titre"
        >
          <Switch
            value={settings.dataSaver}
            onValueChange={(v) => update({ dataSaver: v })}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor="#fff"
          />
        </Row>
        <Row
          label="Charger la vidéo"
          hint="Désactivé : audio uniquement, aucune donnée vidéo téléchargée"
        >
          <Switch
            value={settings.loadVideo}
            onValueChange={(v) => update({ loadVideo: v })}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor="#fff"
          />
        </Row>
        <Row label="Téléchargements en Wi-Fi seulement">
          <Switch
            value={settings.wifiOnlyDownloads}
            onValueChange={(v) => update({ wifiOnlyDownloads: v })}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor="#fff"
          />
        </Row>

        <Text style={styles.section}>Source (sans clé API)</Text>
        {INSTANCES.map((i) => (
          <TouchableOpacity
            key={i}
            style={styles.instance}
            onPress={() => {
              setPreferredInstance(i);
              Alert.alert("Instance prioritaire", i);
            }}
          >
            <Ionicons name="server-outline" size={16} color={colors.textMuted} />
            <Text style={styles.instanceText}>{i.replace("https://", "")}</Text>
          </TouchableOpacity>
        ))}

        <Text style={styles.section}>Sauvegarde</Text>
        <TouchableOpacity style={styles.btn} onPress={doExport}>
          <Text style={styles.btnText}>Exporter mes playlists (JSON)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnOutline} onPress={doImport}>
          <Text style={styles.btnOutlineText}>Importer un fichier JSON</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.btnOutline}
          onPress={() =>
            Alert.alert("Historique", "Effacer tout l'historique ?", [
              { text: "Annuler", style: "cancel" },
              { text: "Effacer", style: "destructive", onPress: () => clearHistory() },
            ])
          }
        >
          <Text style={styles.btnOutlineText}>Effacer l'historique</Text>
        </TouchableOpacity>

        <View style={styles.brandFooter}>
          <Image source={logo} style={styles.brandFooterLogo} resizeMode="contain" />
          <Text style={styles.footer}>
            AudioVibe · 100 % local, sans compte, sans publicité, sans clé API.
          </Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  h1: { color: colors.text, fontSize: 26, fontWeight: "800", marginVertical: 12 },
  section: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 24,
    marginBottom: 8,
  },
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  rowLabel: { color: colors.text, fontSize: 14, fontWeight: "600" },
  rowHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  instance: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  instanceText: { color: colors.textMuted, fontSize: 12 },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  btnText: { color: "#000", fontWeight: "700", fontSize: 14 },
  btnOutline: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 10,
  },
  btnOutlineText: { color: colors.text, fontWeight: "600", fontSize: 14 },
  brandFooter: { alignItems: "center", marginTop: 32, gap: 10 },
  brandFooterLogo: { width: 56, height: 56, borderRadius: 14, opacity: 0.9 },
  footer: { color: colors.textMuted, fontSize: 11, textAlign: "center" },
});
