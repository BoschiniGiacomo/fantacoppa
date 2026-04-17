import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Switch,
  KeyboardAvoidingView,
  Platform,
  Image,
  Modal,
  Keyboard,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { publicAssetUrl } from '../services/api';
import BonusIcon from '../components/BonusIcon';
import * as ImagePicker from 'expo-image-picker';
import { leagueService, marketService } from '../services/api';
import { useOnboarding } from '../context/OnboardingContext';
import { defaultLogos, defaultLogosMap } from '../constants/defaultLogos';
import { parseAppDate } from '../utils/dateTime';

export default function SettingsScreen({ route, navigation }) {
  const { leagueId, section } = route.params || {};
  const insets = useSafeAreaInsets();
  const { updateAutoDetect } = useOnboarding();
  const [league, setLeague] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingBonus, setSavingBonus] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedBonus, setSavedBonus] = useState(false);
  const [savedTeam, setSavedTeam] = useState(false);
  const parseDeadlineDate = (value) => parseAppDate(value);
  const [activeSection, setActiveSection] = useState(section || 'team');
  const [activeGeneralSubsection, setActiveGeneralSubsection] = useState('base');
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [timePickerDate, setTimePickerDate] = useState(new Date());
  const [teamName, setTeamName] = useState('');
  const [coachName, setCoachName] = useState('');
  const [teamLogo, setTeamLogo] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [editingTeamName, setEditingTeamName] = useState(false);
  const [editingCoachName, setEditingCoachName] = useState(false);
  const teamNameInputRef = React.useRef(null);
  const coachNameInputRef = React.useRef(null);
  const scrollViewRef = useRef(null);
  const keyboardHeightRef = useRef(0);
  const currentScrollY = useRef(0);

  // Refs e ordine navigazione per campi bonus/malus
  const bonusInputRefs = useRef({
    bonus_goal: React.createRef(),
    bonus_assist: React.createRef(),
    bonus_penalty_saved: React.createRef(),
    bonus_clean_sheet: React.createRef(),
    malus_yellow_card: React.createRef(),
    malus_red_card: React.createRef(),
    malus_goals_conceded: React.createRef(),
    malus_own_goal: React.createRef(),
    malus_penalty_missed: React.createRef(),
  }).current;

  const bonusFieldsOrder = [
    'bonus_goal', 'bonus_assist', 'bonus_penalty_saved', 'bonus_clean_sheet',
    'malus_yellow_card', 'malus_red_card', 'malus_goals_conceded', 'malus_own_goal', 'malus_penalty_missed',
  ];

  // Listener tastiera per altezza
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      keyboardHeightRef.current = e.endCoordinates.height;
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      keyboardHeightRef.current = 0;
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // Scrolla il campo in vista sopra la tastiera
  const scrollBonusInputIntoView = useCallback((valueKey) => {
    const inputRef = bonusInputRefs[valueKey];
    if (!inputRef?.current || !scrollViewRef.current) return;
    setTimeout(() => {
      // measure() su TextInput dà la posizione assoluta sullo schermo
      inputRef.current.measure((x, y, w, h, pageX, pageY) => {
        if (pageY === undefined) return;
        const screenH = Dimensions.get('window').height;
        const kbH = keyboardHeightRef.current || 260;
        const visibleBottom = screenH - kbH;
        const inputBottom = pageY + h;
        // Se il campo è nascosto dalla tastiera, scrolla
        if (inputBottom > visibleBottom - 40) {
          const scrollBy = inputBottom - visibleBottom + 60;
          scrollViewRef.current.scrollTo({
            y: currentScrollY.current + scrollBy,
            animated: true,
          });
        }
      });
    }, 250);
  }, []);
  
  // Gestione Mercato
  const [marketLocked, setMarketLocked] = useState(false);
  const [marketMembers, setMarketMembers] = useState([]);
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [marketSearch, setMarketSearch] = useState('');
  const [marketFilter, setMarketFilter] = useState('all'); // 'all', 'blocked', 'unblocked'
  const [showLogoModal, setShowLogoModal] = useState(false);

  // Calcola Giornata
  const [matchdayStatuses, setMatchdayStatuses] = useState([]);
  const [loadingCalc, setLoadingCalc] = useState(false);
  const [selectedCalcMatchday, setSelectedCalcMatchday] = useState(null);
  const [use6Politico, setUse6Politico] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [calcResult, setCalcResult] = useState(null);
  const [showRecalcModal, setShowRecalcModal] = useState(false);
  const [calcFeedback, setCalcFeedback] = useState('');
  const [toastMsg, setToastMsg] = useState(null); // { text, type: 'success' | 'error' }
  const [confirmModal, setConfirmModal] = useState(null); // { title, message, confirmText, onConfirm, destructive }
  
  // Impostazioni generali
  const [autoLineupMode, setAutoLineupMode] = useState(false);
  const [requireJoinApproval, setRequireJoinApproval] = useState(false);
  const [settings, setSettings] = useState({
    default_deadline_time: '20:00',
    access_code: '',
    numero_titolari: 11,
    max_portieri: 3,
    max_difensori: 8,
    max_centrocampisti: 8,
    max_attaccanti: 6,
  });
  
  // Impostazioni bonus/malus
  const [bonusSettings, setBonusSettings] = useState({
    enable_bonus_malus: true,
    enable_goal: true,
    bonus_goal: 3.0,
    enable_assist: true,
    bonus_assist: 1.0,
    enable_yellow_card: true,
    malus_yellow_card: -0.5,
    enable_red_card: true,
    malus_red_card: -1.0,
    enable_goals_conceded: false,
    malus_goals_conceded: -1.0,
    enable_own_goal: false,
    malus_own_goal: -2.0,
    enable_penalty_missed: false,
    malus_penalty_missed: -3.0,
    enable_penalty_saved: false,
    bonus_penalty_saved: 3.0,
    enable_clean_sheet: false,
    bonus_clean_sheet: 1.0,
  });
  
  // Stati temporanei per i valori decimali durante la digitazione (null = non in editing)
  const [tempBonusValues, setTempBonusValues] = useState({
    bonus_goal: null,
    bonus_assist: null,
    malus_yellow_card: null,
    malus_red_card: null,
    malus_goals_conceded: null,
    malus_own_goal: null,
    malus_penalty_missed: null,
    bonus_penalty_saved: null,
    bonus_clean_sheet: null,
  });
  
  // Stati temporanei per i valori interi durante la digitazione
  // Usa null per indicare che il campo non è stato ancora toccato
  const [tempIntValues, setTempIntValues] = useState({
    numero_titolari: null,
    max_portieri: null,
    max_difensori: null,
    max_centrocampisti: null,
    max_attaccanti: null,
  });

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  useEffect(() => {
    loadData();
  }, [leagueId]);

  useEffect(() => {
    if (section) {
      setActiveSection(section);
    }
  }, [section]);

  useEffect(() => {
    if (activeSection === 'general' && isAdmin) {
      loadSettings();
    }
    if (activeSection === 'market' && isAdmin) {
      loadMarketSettings();
    }
    if (activeSection === 'calculate' && isAdmin) {
      loadMatchdayStatus();
    }
  }, [activeSection, isAdmin]);

  // Ricarica dati quando la schermata riceve il focus
  useFocusEffect(
    useCallback(() => {
      loadData();
      if (activeSection === 'market' && isAdmin) {
        loadMarketSettings();
      }
      if (activeSection === 'calculate' && isAdmin) {
        loadMatchdayStatus();
      }
    }, [leagueId, activeSection, isAdmin])
  );

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await leagueService.getById(leagueId);
      const leagueData = Array.isArray(res.data) ? res.data[0] : res.data;
      setLeague(leagueData);
      setIsAdmin(leagueData.role === 'admin');
      
      // Carica dati squadra utente (team_name e coach_name sono già inclusi nella risposta)
      if (leagueData.team_name) {
        setTeamName(leagueData.team_name);
      }
      if (leagueData.coach_name) {
        setCoachName(leagueData.coach_name);
      }
      if (leagueData.team_logo) {
        setTeamLogo(leagueData.team_logo);
      } else {
        // Se non c'è logo, usa il primo di default (sarà impostato automaticamente dal backend se necessario)
        setTeamLogo('default_1');
      }
      
      if (!section) {
        setActiveSection(isAdmin ? 'general' : 'team');
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      showToast('Impossibile caricare le impostazioni');
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const res = await leagueService.getSettings(leagueId);
      const data = res.data;
      
      // Assicurati che l'orario sia sempre in formato HH:mm (senza secondi)
      let defaultTime = data.default_deadline_time || '20:00';
      // Rimuovi i secondi se presenti (formato HH:mm:ss)
      defaultTime = defaultTime.split(':').slice(0, 2).join(':');
      const [hours, minutes] = defaultTime.split(':').map(Number);
      const timeDate = new Date();
      timeDate.setHours(hours || 20, minutes || 0, 0, 0);
      
      setSettings({
        default_deadline_time: defaultTime,
        access_code: data.access_code || '',
        numero_titolari: data.numero_titolari || 11,
        max_portieri: data.max_portieri || 3,
        max_difensori: data.max_difensori || 8,
        max_centrocampisti: data.max_centrocampisti || 8,
        max_attaccanti: data.max_attaccanti || 6,
      });
      
      setAutoLineupMode(data.auto_lineup_mode === 1 || data.auto_lineup_mode === true);
      setTimePickerDate(timeDate);
      
      // Carica impostazione approvazione iscrizioni dalla tabella market_settings
      try {
        const marketRes = await marketService.getSettings(leagueId);
        const mData = marketRes.data;
        const approvalEnabled = mData.require_approval === 1 || mData.require_approval === '1';
        setRequireJoinApproval(approvalEnabled);
      } catch (e) {
        console.error('Error loading require_approval:', e);
      }
      
      if (data.bonus_settings) {
        const bs = data.bonus_settings;
        const pf = (val, def) => { const n = parseFloat(val); return isNaN(n) ? def : n; };
        setBonusSettings({
          enable_bonus_malus: parseInt(bs.enable_bonus_malus) === 1,
          enable_goal: parseInt(bs.enable_goal) === 1,
          bonus_goal: pf(bs.bonus_goal, 3.0),
          enable_assist: parseInt(bs.enable_assist) === 1,
          bonus_assist: pf(bs.bonus_assist, 1.0),
          enable_yellow_card: parseInt(bs.enable_yellow_card) === 1,
          malus_yellow_card: pf(bs.malus_yellow_card, -0.5),
          enable_red_card: parseInt(bs.enable_red_card) === 1,
          malus_red_card: pf(bs.malus_red_card, -1.0),
          enable_goals_conceded: parseInt(bs.enable_goals_conceded) === 1,
          malus_goals_conceded: pf(bs.malus_goals_conceded, -1.0),
          enable_own_goal: parseInt(bs.enable_own_goal) === 1,
          malus_own_goal: pf(bs.malus_own_goal, -2.0),
          enable_penalty_missed: parseInt(bs.enable_penalty_missed) === 1,
          malus_penalty_missed: pf(bs.malus_penalty_missed, -3.0),
          enable_penalty_saved: parseInt(bs.enable_penalty_saved) === 1,
          bonus_penalty_saved: pf(bs.bonus_penalty_saved, 3.0),
          enable_clean_sheet: parseInt(bs.enable_clean_sheet) === 1,
          bonus_clean_sheet: pf(bs.bonus_clean_sheet, 1.0),
        });
        // Reset valori temporanei
        setTempBonusValues({
          bonus_goal: null, bonus_assist: null, malus_yellow_card: null,
          malus_red_card: null, malus_goals_conceded: null, malus_own_goal: null,
          malus_penalty_missed: null, bonus_penalty_saved: null, bonus_clean_sheet: null,
        });
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      showToast('Impossibile caricare le impostazioni generali');
    }
  };

  const handleSaveTeam = async () => {
    if (!teamName.trim() || !coachName.trim()) {
      showToast('Nome squadra e nome allenatore sono obbligatori');
      return;
    }

    try {
      setSaving(true);
      await leagueService.updateTeamInfo(leagueId, teamName.trim(), coachName.trim());
      // Aggiorna onboarding: controlla se i nomi sono ancora default
      const isDefault =
        /^Squadra\s*\d+$/i.test(teamName.trim()) &&
        /^Allenatore\s*\d+$/i.test(coachName.trim());
      updateAutoDetect({ hasDefaultNames: isDefault });
      // Ricarica i dati per aggiornare i valori
      await loadData();
      setSavedTeam(true);
      setTimeout(() => setSavedTeam(false), 2000);
    } catch (error) {
      console.error('Error saving team:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Impossibile salvare le impostazioni';
      showToast(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectLogo = async () => {
    try {
      // Richiedi permessi per accedere alla gallery
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showToast('È necessario concedere l\'accesso alla galleria per selezionare un\'immagine');
        return;
      }

      // Apri image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaType?.Images || 'images',
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const picked = result.assets[0];
        const imageUri = picked.uri;

        // Verifica dimensione file (max 2MB) usando metadati picker, evitando fetch(content://) su Android
        const fileSizeBytes = Number(picked?.fileSize || 0);
        const fileSizeMB = fileSizeBytes > 0 ? fileSizeBytes / (1024 * 1024) : 0;

        if (fileSizeMB > 2) {
          showToast('Il file è troppo grande. Massimo 2MB');
          return;
        }

        // Upload logo
        setUploadingLogo(true);
        try {
          const res = await leagueService.uploadTeamLogo(leagueId, imageUri);
          await loadData(); // Ricarica per ottenere il nuovo path
          setShowLogoModal(false); // Chiudi il modal dopo il caricamento
        } catch (error) {
          console.error('Error uploading logo:', error);
          const errorMessage = error.response?.data?.message || error.message || 'Errore nel caricamento del logo';
          showToast(errorMessage);
        } finally {
          setUploadingLogo(false);
        }
      }
    } catch (error) {
      console.error('Error selecting image:', error);
      showToast('Errore nella selezione dell\'immagine');
    }
  };

  const handleRemoveLogo = async () => {
    setConfirmModal({
      title: 'Rimuovi logo',
      message: 'Sei sicuro di voler rimuovere il logo personalizzato? Verrà selezionato il primo logo di default.',
      confirmText: 'Rimuovi',
      destructive: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          setUploadingLogo(true);
          await leagueService.removeTeamLogo(leagueId);
          // Imposta il primo logo di default dopo la rimozione
          await handleSelectDefaultLogo(defaultLogos[0].id);
          setShowLogoModal(false); // Chiudi il modal se aperto
        } catch (error) {
          console.error('Error removing logo:', error);
          const errorMessage = error.response?.data?.message || error.message || 'Errore nella rimozione del logo';
          showToast(errorMessage);
        } finally {
          setUploadingLogo(false);
        }
      },
    });
  };

  const handleSelectDefaultLogo = async (logoId) => {
    try {
      setUploadingLogo(true);
      await leagueService.selectDefaultLogo(leagueId, logoId);
      await loadData(); // Ricarica per ottenere il nuovo path
      setShowLogoModal(false); // Chiudi il modal dopo la selezione
    } catch (error) {
      console.error('Error selecting default logo:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Errore nella selezione del logo';
      showToast(errorMessage);
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSaveSettings = async () => {
    // Valida i valori prima di salvare (controlla anche se sono vuoti o non validi)
    if (!settings.max_portieri || isNaN(settings.max_portieri) || settings.max_portieri < 1 || settings.max_portieri > 10) {
      showToast('Il limite per i portieri deve essere compreso tra 1 e 10');
      return;
    }
    if (!settings.max_difensori || isNaN(settings.max_difensori) || settings.max_difensori < 1 || settings.max_difensori > 20) {
      showToast('Il limite per i difensori deve essere compreso tra 1 e 20');
      return;
    }
    if (!settings.max_centrocampisti || isNaN(settings.max_centrocampisti) || settings.max_centrocampisti < 1 || settings.max_centrocampisti > 20) {
      showToast('Il limite per i centrocampisti deve essere compreso tra 1 e 20');
      return;
    }
    if (!settings.max_attaccanti || isNaN(settings.max_attaccanti) || settings.max_attaccanti < 1 || settings.max_attaccanti > 10) {
      showToast('Il limite per gli attaccanti deve essere compreso tra 1 e 10');
      return;
    }

    try {
      setSaving(true);
      await leagueService.updateSettings(leagueId, settings);
      await loadSettings();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Error saving settings:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Impossibile salvare le impostazioni';
      showToast(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  // Commit valore temporaneo in bonusSettings
  // Per i malus forza automaticamente il segno negativo
  const commitBonusValue = useCallback((valueKey) => {
    const isMalus = valueKey.startsWith('malus_');
    setTempBonusValues(prev => {
      const text = prev[valueKey];
      if (text !== null && text !== '') {
        const cleaned = text.replace(/[^0-9.,-]/g, '').replace(',', '.');
        let num = parseFloat(cleaned);
        if (!isNaN(num)) {
          // Se è un malus, forza il valore negativo
          if (isMalus && num > 0) num = -num;
          setBonusSettings(bs => ({...bs, [valueKey]: num}));
        }
      }
      return {...prev, [valueKey]: null};
    });
  }, []);

  // Mappa valueKey -> enableKey
  const valueToEnableKey = {
    bonus_goal: 'enable_goal', bonus_assist: 'enable_assist',
    bonus_penalty_saved: 'enable_penalty_saved', bonus_clean_sheet: 'enable_clean_sheet',
    malus_yellow_card: 'enable_yellow_card', malus_red_card: 'enable_red_card',
    malus_goals_conceded: 'enable_goals_conceded', malus_own_goal: 'enable_own_goal',
    malus_penalty_missed: 'enable_penalty_missed',
  };

  // Trova il prossimo campo abilitato
  const focusNextBonusField = useCallback((valueKey) => {
    const idx = bonusFieldsOrder.indexOf(valueKey);
    for (let i = idx + 1; i < bonusFieldsOrder.length; i++) {
      const nextKey = bonusFieldsOrder[i];
      if (bonusSettings[valueToEnableKey[nextKey]]) {
        bonusInputRefs[nextKey]?.current?.focus();
        return;
      }
    }
    Keyboard.dismiss();
  }, [bonusSettings]);

  // Helper per renderizzare una riga bonus/malus
  const renderBonusRow = (iconType, label, enableKey, valueKey, placeholder, trackColor) => {
    const isLast = bonusFieldsOrder.indexOf(valueKey) === bonusFieldsOrder.length - 1;
    return (
      <View style={styles.bmRow}>
        <View style={styles.bmRowIconWrap}><BonusIcon type={iconType} size={20} /></View>
        <Text style={styles.bmRowText} numberOfLines={1}>{label}</Text>
        <Switch
          value={bonusSettings[enableKey]}
          onValueChange={(value) => setBonusSettings({...bonusSettings, [enableKey]: value})}
          trackColor={{ false: '#e0e0e0', true: trackColor }}
          thumbColor={bonusSettings[enableKey] ? '#fff' : '#f4f3f4'}
          style={styles.bmRowSw}
        />
        <TextInput
          ref={bonusInputRefs[valueKey]}
          style={[styles.bmRowIn, !bonusSettings[enableKey] && styles.bmRowInDisabled]}
          value={tempBonusValues[valueKey] !== null ? tempBonusValues[valueKey] : bonusSettings[valueKey].toString()}
          onFocus={() => {
            setTempBonusValues(prev => ({...prev, [valueKey]: bonusSettings[valueKey].toString()}));
            scrollBonusInputIntoView(valueKey);
          }}
          onChangeText={(text) => {
            const cleaned = text.replace(/[^0-9.,-]/g, '').replace(',', '.');
            setTempBonusValues(prev => ({...prev, [valueKey]: cleaned}));
          }}
          onBlur={() => commitBonusValue(valueKey)}
          onSubmitEditing={() => {
            commitBonusValue(valueKey);
            focusNextBonusField(valueKey);
          }}
          keyboardType="decimal-pad"
          returnKeyType={isLast ? 'done' : 'next'}
          placeholder={placeholder}
          placeholderTextColor="#999"
          editable={bonusSettings[enableKey]}
        />
      </View>
    );
  };

  const handleSaveBonusSettings = async () => {
    try {
      setSavingBonus(true);
      // Converti i booleani in interi come si aspetta l'API
      const pf = (val, def) => { const n = parseFloat(val); return isNaN(n) ? def : n; };
      const bonusSettingsToSend = {
        enable_bonus_malus: bonusSettings.enable_bonus_malus ? 1 : 0,
        enable_goal: bonusSettings.enable_goal ? 1 : 0,
        bonus_goal: pf(bonusSettings.bonus_goal, 3.0),
        enable_assist: bonusSettings.enable_assist ? 1 : 0,
        bonus_assist: pf(bonusSettings.bonus_assist, 1.0),
        enable_yellow_card: bonusSettings.enable_yellow_card ? 1 : 0,
        malus_yellow_card: pf(bonusSettings.malus_yellow_card, -0.5),
        enable_red_card: bonusSettings.enable_red_card ? 1 : 0,
        malus_red_card: pf(bonusSettings.malus_red_card, -1.0),
        enable_goals_conceded: bonusSettings.enable_goals_conceded ? 1 : 0,
        malus_goals_conceded: pf(bonusSettings.malus_goals_conceded, -1.0),
        enable_own_goal: bonusSettings.enable_own_goal ? 1 : 0,
        malus_own_goal: pf(bonusSettings.malus_own_goal, -2.0),
        enable_penalty_missed: bonusSettings.enable_penalty_missed ? 1 : 0,
        malus_penalty_missed: pf(bonusSettings.malus_penalty_missed, -3.0),
        enable_penalty_saved: bonusSettings.enable_penalty_saved ? 1 : 0,
        bonus_penalty_saved: pf(bonusSettings.bonus_penalty_saved, 3.0),
        enable_clean_sheet: bonusSettings.enable_clean_sheet ? 1 : 0,
        bonus_clean_sheet: pf(bonusSettings.bonus_clean_sheet, 1.0),
      };
      await leagueService.updateBonusSettings(leagueId, bonusSettingsToSend);
      await loadSettings();
      setSavedBonus(true);
      setTimeout(() => setSavedBonus(false), 2000);
    } catch (error) {
      console.error('Error saving bonus settings:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Impossibile salvare le impostazioni';
      showToast(errorMessage);
    } finally {
      setSavingBonus(false);
    }
  };

  // Carica impostazioni mercato
  // === CALCOLA GIORNATA ===
  const loadMatchdayStatus = async () => {
    try {
      setLoadingCalc(true);
      const res = await leagueService.getMatchdayStatus(leagueId);
      setMatchdayStatuses(res.data || []);
      // Auto-seleziona la prima giornata calcolabile (con voti, deadline passata, non calcolata)
      const now = new Date();
      const calculable = (res.data || []).filter(m => {
        const d = parseDeadlineDate(m?.deadline);
        const deadlinePassed = !d || d < now;
        return m.has_votes && deadlinePassed && !m.is_calculated;
      });
      if (calculable.length > 0 && !selectedCalcMatchday) {
        setSelectedCalcMatchday(calculable[0].giornata);
      } else if (!selectedCalcMatchday && (res.data || []).length > 0) {
        // Se nessuna calcolabile, seleziona l'ultima con voti
        const withVotes = (res.data || []).filter(m => m.has_votes);
        if (withVotes.length > 0) {
          setSelectedCalcMatchday(withVotes[withVotes.length - 1].giornata);
        }
      }
    } catch (error) {
      console.error('Error loading matchday status:', error);
    } finally {
      setLoadingCalc(false);
    }
  };

  const handleCalculateMatchday = async () => {
    if (!selectedCalcMatchday) return;
    const matchday = matchdayStatuses.find(m => m.giornata === selectedCalcMatchday);
    if (matchday && matchday.is_calculated) {
      setShowRecalcModal(true);
      return;
    }
    doCalculate(false);
  };

  const doCalculate = async (force) => {
    try {
      setCalculating(true);
      setShowRecalcModal(false);
      const res = await leagueService.calculateMatchday(leagueId, selectedCalcMatchday, use6Politico, force);
      if (res.data?.already_calculated && !force) {
        setShowRecalcModal(true);
        return;
      }
      setCalcResult(res.data);
      setCalcFeedback(res.data?.recalculated ? 'Giornata ricalcolata!' : 'Giornata calcolata!');
      setTimeout(() => setCalcFeedback(''), 3000);
      // Ricarica lo stato
      await loadMatchdayStatus();
    } catch (error) {
      console.error('Error calculating matchday:', error);
      showToast(error.response?.data?.message || 'Impossibile calcolare la giornata');
    } finally {
      setCalculating(false);
    }
  };

  const loadMarketSettings = async () => {
    try {
      setLoadingMarket(true);
      const response = await marketService.getSettings(leagueId);
      const data = response.data;
      setMarketLocked(data.market_locked === 1 || data.market_locked === '1');
      // Normalizza blocked a intero per ogni membro
      const members = (data.members || []).map(m => ({
        ...m,
        blocked: parseInt(m.blocked) || 0
      }));
      setMarketMembers(members);
    } catch (error) {
      console.error('Error loading market settings:', error);
      console.error('Error details:', error.response?.data, 'Status:', error.response?.status);
    } finally {
      setLoadingMarket(false);
    }
  };

  const handleToggleMarketLocked = async (value) => {
    try {
      setMarketLocked(value);
      await marketService.updateSettings(leagueId, 'market_locked', value ? 1 : 0);
      // Ricarica i membri per aggiornare lo stato
      const response = await marketService.getSettings(leagueId);
      const updatedMembers = (response.data.members || []).map(m => ({
        ...m,
        blocked: parseInt(m.blocked) || 0
      }));
      setMarketMembers(updatedMembers);
    } catch (error) {
      console.error('Error toggling market lock:', error);
      setMarketLocked(!value);
      showToast('Impossibile aggiornare lo stato del mercato');
    }
  };

  const handleToggleRequireApproval = async (value) => {
    try {
      setRequireJoinApproval(value);
      await marketService.updateSettings(leagueId, 'require_approval', value ? 1 : 0);
    } catch (error) {
      console.error('Error toggling require approval:', error);
      setRequireJoinApproval(!value);
      showToast('Impossibile aggiornare l\'impostazione');
    }
  };

  // Calcola lo stato effettivo del mercato per un utente
  // blocked nel DB = 1 significa "eccezione" alla regola globale
  const isEffectivelyBlocked = (member) => {
    const hasException = member.blocked === 1;
    if (marketLocked) {
      // Mercato bloccato globalmente: eccezione = sbloccato
      return !hasException; // default bloccato, eccezione = attivo
    } else {
      // Mercato attivo globalmente: eccezione = bloccato
      return hasException; // default attivo, eccezione = bloccato
    }
  };

  const handleToggleUserBlock = async (userId, newEffectiveBlocked) => {
    // Calcola il valore DB da impostare
    // Se mercato bloccato: dbBlocked=1 = eccezione = sbloccato, dbBlocked=0 = bloccato (default)
    // Se mercato sbloccato: dbBlocked=1 = eccezione = bloccato, dbBlocked=0 = attivo (default)
    let newDbBlocked;
    if (marketLocked) {
      newDbBlocked = newEffectiveBlocked ? 0 : 1; // bloccato → nessuna eccezione, sbloccato → eccezione
    } else {
      newDbBlocked = newEffectiveBlocked ? 1 : 0; // bloccato → eccezione, sbloccato → nessuna eccezione
    }

    // Trova il valore precedente per il rollback
    const prevMember = marketMembers.find(m => m.user_id === userId);
    const prevDbBlocked = prevMember ? prevMember.blocked : 0;

    try {
      // Aggiorna localmente subito per UX reattiva
      setMarketMembers(prev => prev.map(m => 
        m.user_id === userId ? { ...m, blocked: newDbBlocked } : m
      ));
      await marketService.updateUserBlock(leagueId, userId, newDbBlocked);
    } catch (error) {
      console.error('Error toggling user block:', error);
      // Ripristina
      setMarketMembers(prev => prev.map(m => 
        m.user_id === userId ? { ...m, blocked: prevDbBlocked } : m
      ));
      showToast('Impossibile aggiornare il blocco utente');
    }
  };

  // Filtra i membri in base alla ricerca e al filtro stato (usa stato effettivo)
  const getFilteredMembers = () => {
    let filtered = marketMembers;
    
    // Filtro per stato effettivo
    if (marketFilter === 'blocked') {
      filtered = filtered.filter(m => isEffectivelyBlocked(m));
    } else if (marketFilter === 'unblocked') {
      filtered = filtered.filter(m => !isEffectivelyBlocked(m));
    }
    
    // Filtro per ricerca
    if (marketSearch.trim()) {
      const search = marketSearch.toLowerCase();
      filtered = filtered.filter(m => 
        (m.username || '').toLowerCase().includes(search) ||
        (m.team_name || '').toLowerCase().includes(search) ||
        (m.coach_name || '').toLowerCase().includes(search)
      );
    }
    return filtered;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#667eea" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Impostazioni</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView 
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
      <ScrollView 
        ref={scrollViewRef}
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={(e) => { currentScrollY.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
      >
        {/* Mostra le tab solo se non c'è una sezione specifica (section === null/undefined) */}
        {!section && (
          <View style={styles.tabsContainer}>
            {isAdmin && (
              <TouchableOpacity
                style={[styles.tab, activeSection === 'general' && styles.tabActive]}
                onPress={() => setActiveSection('general')}
              >
                <Text style={[styles.tabText, activeSection === 'general' && styles.tabTextActive]}>
                  Generali
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.tab, activeSection === 'team' && styles.tabActive]}
              onPress={() => setActiveSection('team')}
            >
              <Text style={[styles.tabText, activeSection === 'team' && styles.tabTextActive]}>
                Modifica nome squadra/allenatore
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Content Sections */}
        {activeSection === 'general' && isAdmin && (
          <View style={styles.section}>
            {/* Tab per sottosezioni */}
            <View style={styles.generalTabsContainer}>
              <TouchableOpacity
                style={[styles.generalTab, activeGeneralSubsection === 'base' && styles.generalTabActive]}
                onPress={() => setActiveGeneralSubsection('base')}
              >
                <Ionicons 
                  name="settings-outline" 
                  size={16} 
                  color={activeGeneralSubsection === 'base' ? '#fff' : '#666'} 
                  style={styles.generalTabIcon}
                />
                <Text style={[styles.generalTabText, activeGeneralSubsection === 'base' && styles.generalTabTextActive]}>
                  Base
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.generalTab, activeGeneralSubsection === 'bonus' && styles.generalTabActive]}
                onPress={() => setActiveGeneralSubsection('bonus')}
              >
                <Ionicons 
                  name="trophy-outline" 
                  size={16} 
                  color={activeGeneralSubsection === 'bonus' ? '#fff' : '#666'} 
                  style={styles.generalTabIcon}
                />
                <Text style={[styles.generalTabText, activeGeneralSubsection === 'bonus' && styles.generalTabTextActive]}>
                  Bonus
                </Text>
              </TouchableOpacity>
            </View>

            {/* Sottosezione Impostazioni Base */}
            {activeGeneralSubsection === 'base' && (
              <>
            {/* Orario e Approvazione iscrizioni */}
            <View style={styles.formGroupRow}>
              {!autoLineupMode && (
              <>
              <View style={styles.formGroupHalf}>
                <View style={styles.labelContainer}>
                  <Ionicons name="time-outline" size={18} color="#667eea" style={styles.labelIcon} />
                  <Text style={styles.label}>Orario scadenze</Text>
                </View>
                <Text style={styles.subtitle}>Orario di default per le scadenze</Text>
                <TouchableOpacity
                  style={styles.input}
                  onPress={() => {
                    // Prepara la data con l'orario corrente (solo ore e minuti, senza secondi)
                    const timeStr = settings.default_deadline_time.split(':').slice(0, 2).join(':');
                    const [hours, minutes] = timeStr.split(':').map(Number);
                    const date = new Date();
                    date.setHours(hours || 20, minutes || 0, 0, 0);
                    setTimePickerDate(date);
                    setShowTimePicker(true);
                  }}
                >
                  <Text style={styles.timeInputText}>
                    {settings.default_deadline_time.split(':').slice(0, 2).join(':')}
                  </Text>
                </TouchableOpacity>
                {showTimePicker && (
                  <DateTimePicker
                    value={timePickerDate}
                    mode="time"
                    is24Hour={true}
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(event, selectedDate) => {
                      setShowTimePicker(Platform.OS === 'ios');
                      if (selectedDate) {
                        const hours = selectedDate.getHours().toString().padStart(2, '0');
                        const minutes = selectedDate.getMinutes().toString().padStart(2, '0');
                        const timeString = `${hours}:${minutes}`;
                        setSettings({...settings, default_deadline_time: timeString});
                        // Imposta i secondi a 0 per sicurezza
                        selectedDate.setSeconds(0, 0);
                        setTimePickerDate(selectedDate);
                      }
                    }}
                  />
                )}
              </View>
              <View style={styles.formGroupSeparator} />
              </>
              )}
              <View style={autoLineupMode ? styles.formGroupFull : styles.formGroupHalf}>
                <View style={styles.labelContainer}>
                  <Ionicons name="person-add-outline" size={18} color="#667eea" style={styles.labelIcon} />
                  <Text style={styles.label}>Approvazione iscrizioni</Text>
                </View>
                <Text style={styles.subtitle}>
                  {requireJoinApproval 
                    ? 'Richiede approvazione admin' 
                    : 'Iscrizione libera'}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                  <Text style={{ fontSize: 13, color: requireJoinApproval ? '#28a745' : '#999', flex: 1 }}>
                    {requireJoinApproval ? 'Attiva' : 'Disattiva'}
                  </Text>
                  <Switch
                    value={requireJoinApproval}
                    onValueChange={handleToggleRequireApproval}
                  />
                </View>
              </View>
            </View>

            {/* Codice di accesso */}
            <View style={styles.formGroup}>
              <View style={styles.labelContainer}>
                <Ionicons name="lock-closed-outline" size={18} color="#667eea" style={styles.labelIcon} />
                <Text style={styles.label}>Codice accesso</Text>
              </View>
              <Text style={styles.subtitle}>Lascia vuoto per nessun codice</Text>
              <TextInput
                style={styles.input}
                value={settings.access_code}
                onChangeText={(text) => setSettings({...settings, access_code: text})}
                placeholder="Codice di accesso"
                maxLength={20}
              />
            </View>

            {/* Limiti per ruolo */}
            <Text style={styles.subsectionTitle}>Limite giocatori per ruolo</Text>
            <View style={styles.roleLimitsContainer}>
              <View style={styles.roleLimitItem}>
                <Text style={styles.roleLabel}>Portieri</Text>
                <TextInput
                  style={styles.roleInput}
                  value={tempIntValues.max_portieri !== null ? tempIntValues.max_portieri : settings.max_portieri.toString()}
                  onChangeText={(text) => {
                    // Rimuovi caratteri non numerici e salva solo nello stato temporaneo
                    const cleaned = text.replace(/[^0-9]/g, '');
                    setTempIntValues({...tempIntValues, max_portieri: cleaned});
                  }}
                  onBlur={() => {
                    // Quando perde il focus, aggiorna lo stato principale con il valore temporaneo (senza validazione)
                    // Se il campo è vuoto, mantieni il valore precedente
                    const text = tempIntValues.max_portieri;
                    if (text !== null && text !== '') {
                      const cleaned = text.replace(/[^0-9]/g, '');
                      const num = parseInt(cleaned);
                      if (!isNaN(num)) {
                        setSettings({...settings, max_portieri: num});
                      }
                    }
                    // Reset a null quando perdi il focus
                    setTempIntValues({...tempIntValues, max_portieri: null});
                  }}
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.roleSeparator} />
              <View style={styles.roleLimitItem}>
                <Text style={styles.roleLabel}>Difensori</Text>
                <TextInput
                  style={styles.roleInput}
                  value={tempIntValues.max_difensori !== null ? tempIntValues.max_difensori : settings.max_difensori.toString()}
                  onChangeText={(text) => {
                    // Rimuovi caratteri non numerici e salva solo nello stato temporaneo
                    const cleaned = text.replace(/[^0-9]/g, '');
                    setTempIntValues({...tempIntValues, max_difensori: cleaned});
                  }}
                  onBlur={() => {
                    // Quando perde il focus, aggiorna lo stato principale con il valore temporaneo (senza validazione)
                    // Se il campo è vuoto, mantieni il valore precedente
                    const text = tempIntValues.max_difensori;
                    if (text !== null && text !== '') {
                      const cleaned = text.replace(/[^0-9]/g, '');
                      const num = parseInt(cleaned);
                      if (!isNaN(num)) {
                        setSettings({...settings, max_difensori: num});
                      }
                    }
                    // Reset a null quando perdi il focus
                    setTempIntValues({...tempIntValues, max_difensori: null});
                  }}
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.roleSeparator} />
              <View style={styles.roleLimitItem}>
                <Text style={styles.roleLabel}>Centrocampisti</Text>
                <TextInput
                  style={styles.roleInput}
                  value={tempIntValues.max_centrocampisti !== null ? tempIntValues.max_centrocampisti : settings.max_centrocampisti.toString()}
                  onChangeText={(text) => {
                    // Rimuovi caratteri non numerici e salva solo nello stato temporaneo
                    const cleaned = text.replace(/[^0-9]/g, '');
                    setTempIntValues({...tempIntValues, max_centrocampisti: cleaned});
                  }}
                  onBlur={() => {
                    // Quando perde il focus, aggiorna lo stato principale con il valore temporaneo (senza validazione)
                    // Se il campo è vuoto, mantieni il valore precedente
                    const text = tempIntValues.max_centrocampisti;
                    if (text !== null && text !== '') {
                      const cleaned = text.replace(/[^0-9]/g, '');
                      const num = parseInt(cleaned);
                      if (!isNaN(num)) {
                        setSettings({...settings, max_centrocampisti: num});
                      }
                    }
                    // Reset a null quando perdi il focus
                    setTempIntValues({...tempIntValues, max_centrocampisti: null});
                  }}
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.roleSeparator} />
              <View style={styles.roleLimitItem}>
                <Text style={styles.roleLabel}>Attaccanti</Text>
                <TextInput
                  style={styles.roleInput}
                  value={tempIntValues.max_attaccanti !== null ? tempIntValues.max_attaccanti : settings.max_attaccanti.toString()}
                  onChangeText={(text) => {
                    // Rimuovi caratteri non numerici e salva solo nello stato temporaneo
                    const cleaned = text.replace(/[^0-9]/g, '');
                    setTempIntValues({...tempIntValues, max_attaccanti: cleaned});
                  }}
                  onBlur={() => {
                    // Quando perde il focus, aggiorna lo stato principale con il valore temporaneo (senza validazione)
                    // Se il campo è vuoto, mantieni il valore precedente
                    const text = tempIntValues.max_attaccanti;
                    if (text !== null && text !== '') {
                      const cleaned = text.replace(/[^0-9]/g, '');
                      const num = parseInt(cleaned);
                      if (!isNaN(num)) {
                        setSettings({...settings, max_attaccanti: num});
                      }
                    }
                    // Reset a null quando perdi il focus
                    setTempIntValues({...tempIntValues, max_attaccanti: null});
                  }}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <TouchableOpacity 
              style={[
                styles.saveButton, 
                saving && styles.saveButtonDisabled,
                saved && styles.saveButtonSuccess
              ]} 
              onPress={handleSaveSettings}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : saved ? (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.saveButtonText}>Salvato</Text>
                </>
              ) : (
                <Text style={styles.saveButtonText}>Salva</Text>
              )}
            </TouchableOpacity>
              </>
            )}

            {/* Sottosezione Bonus/Malus */}
            {activeGeneralSubsection === 'bonus' && (
              <>
                {/* Header con switch abilitazione */}
                <View style={styles.formGroup}>
                  <View style={styles.labelContainer}>
                    <Ionicons name="trophy-outline" size={18} color="#667eea" style={styles.labelIcon} />
                    <Text style={styles.label}>Bonus/Malus Lega</Text>
                    <Switch
                      value={bonusSettings.enable_bonus_malus}
                      onValueChange={(value) => setBonusSettings({...bonusSettings, enable_bonus_malus: value})}
                      style={{ marginLeft: 'auto' }}
                    />
                  </View>
                  <Text style={styles.subtitle}>Abilita o disabilita il sistema bonus/malus per la lega</Text>
                </View>

                {bonusSettings.enable_bonus_malus && (
                  <>
                    <Text style={styles.bmSectionLabel}>Bonus</Text>
                    {renderBonusRow('goal', 'Goal segnato', 'enable_goal', 'bonus_goal', '3.0', '#4CAF50')}
                    {renderBonusRow('assist', 'Assist', 'enable_assist', 'bonus_assist', '1.0', '#4CAF50')}
                    {renderBonusRow('penalty_saved', 'Rigore parato', 'enable_penalty_saved', 'bonus_penalty_saved', '3.0', '#4CAF50')}
                    {renderBonusRow('clean_sheet', 'Clean sheet', 'enable_clean_sheet', 'bonus_clean_sheet', '1.0', '#4CAF50')}

                    <Text style={[styles.bmSectionLabel, { marginTop: 12 }]}>Malus</Text>
                    {renderBonusRow('yellow_card', 'Cartellino giallo', 'enable_yellow_card', 'malus_yellow_card', '-0.5', '#e53935')}
                    {renderBonusRow('red_card', 'Cartellino rosso', 'enable_red_card', 'malus_red_card', '-1.0', '#e53935')}
                    {renderBonusRow('goals_conceded', 'Goal subito', 'enable_goals_conceded', 'malus_goals_conceded', '-1.0', '#e53935')}
                    {renderBonusRow('own_goal', 'Autogoal', 'enable_own_goal', 'malus_own_goal', '-2.0', '#e53935')}
                    {renderBonusRow('penalty_missed', 'Rigore sbagliato', 'enable_penalty_missed', 'malus_penalty_missed', '-3.0', '#e53935')}
                  </>
                )}

                {/* Pulsante Salva sempre visibile */}
                <TouchableOpacity 
                  style={[
                    styles.saveButton, 
                    savingBonus && styles.saveButtonDisabled,
                    savedBonus && styles.saveButtonSuccess
                  ]} 
                  onPress={handleSaveBonusSettings}
                  disabled={savingBonus}
                >
                  {savingBonus ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : savedBonus ? (
                    <>
                      <Ionicons name="checkmark-circle" size={20} color="#fff" style={{ marginRight: 8 }} />
                      <Text style={styles.saveButtonText}>Salvato</Text>
                    </>
                  ) : (
                    <Text style={styles.saveButtonText}>Salva</Text>
                  )}
                </TouchableOpacity>
              </>
            )}

          </View>
        )}

        {activeSection === 'team' && (
          <View style={styles.section}>
            {/* Logo Squadra - Visualizzazione principale */}
            <View style={styles.teamProfileContainer}>
              {/* Logo selezionato con pulsante modifica sovrapposto */}
              <View style={styles.selectedLogoContainer}>
                {uploadingLogo ? (
                  <View style={styles.selectedLogoCircle}>
                    <ActivityIndicator size="large" color="#667eea" />
                  </View>
                ) : teamLogo && !teamLogo.startsWith('default_') ? (
                  <View style={styles.logoWrapper}>
                    <Image 
                      source={{ uri: publicAssetUrl(teamLogo) }} 
                      style={styles.selectedLogoImage}
                    />
                    <TouchableOpacity 
                      style={styles.editLogoBadge}
                      onPress={() => setShowLogoModal(true)}
                      disabled={uploadingLogo}
                    >
                      <Ionicons name="create-outline" size={18} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.logoWrapper}>
                    <View style={[
                      styles.selectedLogoCircle, 
                      { backgroundColor: (defaultLogosMap[teamLogo]?.color || '#667eea') + '30' }
                    ]}>
                      <Text style={styles.selectedLogoEmoji}>
                        {defaultLogosMap[teamLogo]?.emoji || '⚽'}
                      </Text>
                    </View>
                    <TouchableOpacity 
                      style={styles.editLogoBadge}
                      onPress={() => setShowLogoModal(true)}
                      disabled={uploadingLogo}
                    >
                      <Ionicons name="create-outline" size={18} color="#fff" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Nome squadra e allenatore su una sola riga */}
              <View style={styles.teamInfoRow}>
                <TouchableOpacity 
                  style={styles.teamInfoItem} 
                  activeOpacity={0.7}
                  onPress={() => {
                    setEditingTeamName(true);
                    setTimeout(() => teamNameInputRef.current?.focus(), 50);
                  }}
                >
                  <Ionicons name="shirt-outline" size={16} color="#667eea" style={{ marginRight: 6 }} />
                  {editingTeamName ? (
                    <TextInput
                      ref={teamNameInputRef}
                      style={styles.teamInfoInput}
                      value={teamName}
                      onChangeText={setTeamName}
                      placeholder="Squadra"
                      placeholderTextColor="#999"
                      onBlur={() => setEditingTeamName(false)}
                    />
                  ) : (
                    <Text style={styles.teamInfoText} numberOfLines={1} ellipsizeMode="tail">
                      {teamName || 'Squadra'}
                    </Text>
                  )}
                </TouchableOpacity>
                <View style={styles.teamInfoSeparator} />
                <TouchableOpacity 
                  style={styles.teamInfoItem} 
                  activeOpacity={0.7}
                  onPress={() => {
                    setEditingCoachName(true);
                    setTimeout(() => coachNameInputRef.current?.focus(), 50);
                  }}
                >
                  <Ionicons name="person-outline" size={16} color="#667eea" style={{ marginRight: 6 }} />
                  {editingCoachName ? (
                    <TextInput
                      ref={coachNameInputRef}
                      style={styles.teamInfoInput}
                      value={coachName}
                      onChangeText={setCoachName}
                      placeholder="Allenatore"
                      placeholderTextColor="#999"
                      onBlur={() => setEditingCoachName(false)}
                    />
                  ) : (
                    <Text style={styles.teamInfoText} numberOfLines={1} ellipsizeMode="tail">
                      {coachName || 'Allenatore'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Pulsante Salva */}
            <TouchableOpacity 
              style={[
                styles.saveButton, 
                saving && styles.saveButtonDisabled,
                savedTeam && styles.saveButtonSuccess
              ]} 
              onPress={handleSaveTeam}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : savedTeam ? (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.saveButtonText}>Salvato</Text>
                </>
              ) : (
                <Text style={styles.saveButtonText}>Salva</Text>
              )}
            </TouchableOpacity>

            {/* Modal per modificare logo */}
            <Modal
              visible={showLogoModal}
              animationType="slide"
              transparent={true}
              onRequestClose={() => setShowLogoModal(false)}
            >
              <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Scegli Logo</Text>
                    <TouchableOpacity 
                      onPress={() => setShowLogoModal(false)}
                      style={styles.modalCloseButton}
                    >
                      <Ionicons name="close" size={24} color="#666" />
                    </TouchableOpacity>
                  </View>

                  <ScrollView style={styles.modalScrollView}>
                    {/* Griglia loghi di default */}
                    <Text style={styles.defaultLogosTitle}>Loghi di default:</Text>
                    <View style={styles.defaultLogosGrid}>
                      {defaultLogos.map((logo) => {
                        const isSelected = teamLogo === logo.id;
                        return (
                          <TouchableOpacity
                            key={logo.id}
                            style={[
                              styles.defaultLogoItem,
                              isSelected && styles.defaultLogoItemSelected,
                              { backgroundColor: logo.color + '20' }
                            ]}
                            onPress={() => handleSelectDefaultLogo(logo.id)}
                            disabled={uploadingLogo}
                          >
                            <View style={[styles.defaultLogoCircle, { backgroundColor: logo.color + '30' }]}>
                              <Text style={styles.defaultLogoEmoji}>{logo.emoji}</Text>
                            </View>
                            {isSelected && (
                              <View style={styles.defaultLogoCheck}>
                                <Ionicons name="checkmark-circle" size={20} color="#198754" />
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {/* Opzione caricare immagine personalizzata */}
                    <View style={styles.customLogoSection}>
                      <Text style={styles.customLogoTitle}>O carica un'immagine personalizzata:</Text>
                      <TouchableOpacity 
                        style={styles.uploadButton}
                        onPress={handleSelectLogo}
                        disabled={uploadingLogo}
                      >
                        {uploadingLogo ? (
                          <ActivityIndicator size="small" color="#667eea" />
                        ) : (
                          <>
                            <Ionicons name="image-outline" size={24} color="#667eea" />
                            <Text style={styles.uploadButtonText}>Carica Immagine (JPG/PNG, max 2MB)</Text>
                          </>
                        )}
                      </TouchableOpacity>
                      
                      {/* Rimuovi logo se c'è un logo personalizzato */}
                      {teamLogo && !teamLogo.startsWith('default_') && (
                        <TouchableOpacity 
                          style={styles.removeButton}
                          onPress={handleRemoveLogo}
                          disabled={uploadingLogo}
                        >
                          <Ionicons name="trash-outline" size={20} color="#ef4444" />
                          <Text style={styles.removeButtonText}>Rimuovi Logo Personalizzato</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </ScrollView>
                </View>
              </View>
            </Modal>
          </View>
        )}

        {activeSection === 'calculate' && isAdmin && (
          <View style={styles.section}>
            {loadingCalc ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#667eea" />
              </View>
            ) : (
              <>
                <Text style={styles.sectionTitle}>Calcola Giornata</Text>
                <Text style={{ color: '#666', marginBottom: 16, fontSize: 13 }}>
                  Calcola i punteggi di una giornata per aggiornarli in classifica. Solo le giornate calcolate contano per la classifica generale.
                </Text>

                {/* Selettore giornata */}
                <Text style={{ fontWeight: '600', color: '#333', marginBottom: 8 }}>Seleziona giornata</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                  {matchdayStatuses.map(m => {
                    const now = new Date();
                    const isCalculated = Number(m?.is_calculated) === 1;
                    const hasVotes = Number(m?.has_votes) === 1;
                    const d = parseDeadlineDate(m?.deadline);
                    const deadlinePassed = !d || d < now;
                    const isSelected = selectedCalcMatchday === m.giornata;
                    return (
                      <TouchableOpacity
                        key={m.giornata}
                        style={[
                          styles.calcMatchdayPill,
                          isSelected && styles.calcMatchdayPillActive,
                          isCalculated && styles.calcMatchdayPillCalculated,
                          isSelected && isCalculated && styles.calcMatchdayPillCalcActive,
                        ]}
                        onPress={() => { setSelectedCalcMatchday(m.giornata); setCalcResult(null); }}
                      >
                        <Text style={[
                          styles.calcMatchdayPillText,
                          isSelected && styles.calcMatchdayPillTextActive,
                          isCalculated && !isSelected && { color: '#198754' },
                        ]}>
                          G{m.giornata}
                        </Text>
                        {isCalculated && (
                          <Ionicons name="checkmark-circle" size={12} color={isSelected ? '#fff' : '#198754'} style={{ marginLeft: 3 }} />
                        )}
                        {!isCalculated && hasVotes && deadlinePassed && (
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#e6a800', marginLeft: 4 }} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {/* Info giornata selezionata */}
                {selectedCalcMatchday && (() => {
                  const md = matchdayStatuses.find(m => m.giornata === selectedCalcMatchday);
                  if (!md) return null;
                  const mdIsCalculated = Number(md?.is_calculated) === 1;
                  const mdHasVotes = Number(md?.has_votes) === 1;
                  return (
                    <View style={styles.calcInfoCard}>
                      <View style={styles.calcInfoRow}>
                        <Text style={styles.calcInfoLabel}>Stato:</Text>
                        <View style={[styles.calcStatusBadge, mdIsCalculated ? styles.calcStatusCalc : styles.calcStatusNotCalc]}>
                          <Text style={[styles.calcStatusText, mdIsCalculated ? { color: '#198754' } : { color: '#e6a800' }]}>
                            {mdIsCalculated ? 'Calcolata' : 'Non calcolata'}
                          </Text>
                        </View>
                      </View>
                      {mdIsCalculated && md.calculated_at && (
                        <View style={styles.calcInfoRow}>
                          <Text style={styles.calcInfoLabel}>Calcolata il:</Text>
                          <Text style={styles.calcInfoValue}>
                            {(() => {
                              const d = parseDeadlineDate(md.calculated_at);
                              return d ? d.toLocaleString('it-IT') : '-';
                            })()}
                          </Text>
                        </View>
                      )}
                      <View style={styles.calcInfoRow}>
                        <Text style={styles.calcInfoLabel}>Voti inseriti:</Text>
                        <Text style={styles.calcInfoValue}>{mdHasVotes ? `${md.votes_count} giocatori` : 'Nessuno'}</Text>
                      </View>
                      {md.deadline && (
                        <View style={styles.calcInfoRow}>
                          <Text style={styles.calcInfoLabel}>Scadenza:</Text>
                          <Text style={styles.calcInfoValue}>
                            {(() => {
                              const d = parseDeadlineDate(md.deadline);
                              return d ? d.toLocaleString('it-IT') : '-';
                            })()}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })()}

                {/* Checkbox 6 politico */}
                <TouchableOpacity
                  style={styles.calc6PoliticoRow}
                  onPress={() => setUse6Politico(!use6Politico)}
                >
                  <View style={[styles.calcCheckbox, use6Politico && styles.calcCheckboxActive]}>
                    {use6Politico && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.calc6PoliticoText}>Applica 6 politico</Text>
                    <Text style={styles.calc6PoliticoDesc}>Assegna 6.0 a tutti i giocatori delle squadre senza voti</Text>
                  </View>
                </TouchableOpacity>

                {/* Pulsante Calcola */}
                <TouchableOpacity
                  style={[styles.calcButton, calculating && { opacity: 0.6 }]}
                  onPress={handleCalculateMatchday}
                  disabled={calculating || !selectedCalcMatchday}
                >
                  {calculating ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="calculator" size={18} color="#fff" />
                      <Text style={styles.calcButtonText}>
                        {matchdayStatuses.find(m => m.giornata === selectedCalcMatchday)?.is_calculated ? 'Ricalcola Giornata' : 'Calcola Giornata'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                {/* Feedback */}
                {calcFeedback !== '' && (
                  <View style={styles.calcFeedback}>
                    <Ionicons name="checkmark-circle" size={18} color="#198754" />
                    <Text style={styles.calcFeedbackText}>{calcFeedback}</Text>
                  </View>
                )}

              </>
            )}

            {/* Modal conferma ricalcolo */}
            <Modal visible={showRecalcModal} transparent animationType="fade" onRequestClose={() => setShowRecalcModal(false)}>
              <View style={styles.modalOverlayCalc}>
                <View style={styles.modalCardCalc}>
                  <Ionicons name="alert-circle" size={36} color="#e6a800" />
                  <Text style={styles.modalTitleCalc}>Giornata già calcolata</Text>
                  <Text style={styles.modalDescCalc}>I risultati precedenti verranno sovrascritti. Continuare?</Text>
                  <View style={styles.modalButtonsCalc}>
                    <TouchableOpacity style={styles.modalCancelBtnCalc} onPress={() => setShowRecalcModal(false)}>
                      <Text style={{ color: '#333', fontWeight: '600' }}>Annulla</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalConfirmBtnCalc, calculating && { opacity: 0.6 }]}
                      onPress={() => doCalculate(true)}
                      disabled={calculating}
                    >
                      {calculating ? <ActivityIndicator color="#fff" size="small" /> : (
                        <Text style={{ color: '#fff', fontWeight: '600' }}>Ricalcola</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>
          </View>
        )}

        {activeSection === 'market' && isAdmin && (
          <View style={styles.section}>
            {loadingMarket ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#667eea" />
              </View>
            ) : (
              <>
                {/* Stato globale mercato */}
                <View style={styles.marketStatusBadge}>
                  <View style={[styles.marketStatusDot, { backgroundColor: marketLocked ? '#dc3545' : '#28a745' }]} />
                  <Text style={styles.marketStatusText}>
                    Stato: {marketLocked ? 'Mercato Bloccato' : 'Mercato Attivo'}
                  </Text>
                  <Switch
                    value={marketLocked}
                    onValueChange={handleToggleMarketLocked}
                    style={{ marginLeft: 'auto' }}
                    trackColor={{ false: '#28a745', true: '#dc3545' }}
                    thumbColor="#fff"
                  />
                </View>

                {/* Barra di ricerca - stile gestione utenti */}
                <View style={styles.mktSearchContainer}>
                  <Ionicons name="search" size={20} color="#666" style={styles.mktSearchIcon} />
                  <TextInput
                    style={styles.mktSearchInput}
                    placeholder="Cerca per nome, squadra o allenatore..."
                    placeholderTextColor="#999"
                    value={marketSearch}
                    onChangeText={setMarketSearch}
                  />
                  {marketSearch !== '' && (
                    <TouchableOpacity onPress={() => setMarketSearch('')} style={styles.mktClearButton}>
                      <Ionicons name="close-circle" size={20} color="#666" />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Filtri stato - stile gestione utenti */}
                <View style={styles.mktFiltersContainer}>
                  <Ionicons name="filter" size={14} color="#666" style={{ marginRight: 2 }} />
                  <TouchableOpacity
                    style={[styles.mktFilterChip, marketFilter === 'all' && { backgroundColor: '#667eea', borderColor: '#667eea' }]}
                    onPress={() => setMarketFilter('all')}
                  >
                    <Ionicons name="people" size={11} color={marketFilter === 'all' ? '#fff' : '#667eea'} style={{ marginRight: 3 }} />
                    <Text style={[styles.mktFilterChipText, marketFilter === 'all' && styles.mktFilterChipTextActive]}>
                      Tutti
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.mktFilterChip, marketFilter === 'blocked' && { backgroundColor: '#dc3545', borderColor: '#dc3545' }]}
                    onPress={() => setMarketFilter('blocked')}
                  >
                    <Ionicons name="lock-closed" size={11} color={marketFilter === 'blocked' ? '#fff' : '#dc3545'} style={{ marginRight: 3 }} />
                    <Text style={[styles.mktFilterChipText, marketFilter === 'blocked' && styles.mktFilterChipTextActive]}>
                      No mercato ({marketMembers.filter(m => isEffectivelyBlocked(m)).length})
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.mktFilterChip, marketFilter === 'unblocked' && { backgroundColor: '#28a745', borderColor: '#28a745' }]}
                    onPress={() => setMarketFilter('unblocked')}
                  >
                    <Ionicons name="lock-open" size={11} color={marketFilter === 'unblocked' ? '#fff' : '#28a745'} style={{ marginRight: 3 }} />
                    <Text style={[styles.mktFilterChipText, marketFilter === 'unblocked' && styles.mktFilterChipTextActive]}>
                      Mercato attivo ({marketMembers.filter(m => !isEffectivelyBlocked(m)).length})
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Lista utenti - stile gestione utenti */}
                {getFilteredMembers().length === 0 ? (
                  <View style={styles.marketEmptyContainer}>
                    <Text style={styles.marketEmptyText}>
                      {marketSearch.trim() 
                        ? 'Nessun utente trovato'
                        : 'Nessun utente in questa categoria'}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.mktUserList}>
                    {getFilteredMembers().map((member) => {
                      const effectiveBlocked = isEffectivelyBlocked(member);
                      return (
                        <View key={member.user_id} style={styles.mktMemberItem}>
                          <View style={styles.mktMemberInfo}>
                            <View style={styles.mktMemberHeaderRow}>
                              <Text style={styles.mktMemberUsername}>{member.username}</Text>
                              <View style={[
                                styles.marketUserBadge,
                                { backgroundColor: effectiveBlocked ? '#dc354520' : '#28a74520' }
                              ]}>
                                <Text style={[
                                  styles.marketUserBadgeText,
                                  { color: effectiveBlocked ? '#dc3545' : '#28a745' }
                                ]}>
                                  {effectiveBlocked ? 'Bloccato' : 'Attivo'}
                                </Text>
                              </View>
                            </View>
                            <Text style={styles.mktMemberTeam}>
                              {member.team_name || 'Senza squadra'} - {member.coach_name || 'Senza allenatore'}
                            </Text>
                          </View>
                          <Switch
                            value={effectiveBlocked}
                            onValueChange={(newBlocked) => handleToggleUserBlock(member.user_id, newBlocked)}
                            trackColor={{ false: '#28a745', true: '#dc3545' }}
                            thumbColor="#fff"
                          />
                        </View>
                      );
                    })}
                  </View>
                )}
              </>
            )}
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Modal di conferma */}
      <Modal
        visible={!!confirmModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setConfirmModal(null)}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmContent}>
            <View style={styles.confirmIconWrap}>
              <Ionicons
                name={confirmModal?.destructive ? 'warning' : 'information-circle'}
                size={40}
                color={confirmModal?.destructive ? '#e53935' : '#667eea'}
              />
            </View>
            <Text style={styles.confirmTitle}>{confirmModal?.title}</Text>
            <Text style={styles.confirmMessage}>{confirmModal?.message}</Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity
                style={styles.confirmBtnCancel}
                onPress={() => setConfirmModal(null)}
              >
                <Text style={styles.confirmBtnCancelText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtnAction, confirmModal?.destructive && { backgroundColor: '#e53935' }]}
                onPress={() => confirmModal?.onConfirm?.()}
              >
                <Text style={styles.confirmBtnActionText}>{confirmModal?.confirmText || 'Conferma'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Toast */}
      {toastMsg && (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons
            name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'}
            size={18}
            color="#fff"
          />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f3f7',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#f2f3f7',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#333',
  },
  content: {
    flex: 1,
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  tabActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  tabText: {
    fontSize: 13,
    color: '#666',
    fontWeight: '600',
    textAlign: 'center',
  },
  tabTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  section: {
    padding: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 14,
  },
  generalTabsContainer: {
    flexDirection: 'row',
    marginBottom: 14,
    gap: 8,
  },
  generalTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  generalTabActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  generalTabIcon: {
    marginRight: 6,
  },
  generalTabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '600',
  },
  generalTabTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  formGroup: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  formGroupRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    alignItems: 'flex-start',
  },
  formGroupHalf: {
    flex: 1,
  },
  formGroupFull: {
    flex: 1,
    width: '100%',
  },
  formGroupSeparator: {
    width: 1,
    backgroundColor: '#eee',
    marginHorizontal: 12,
    alignSelf: 'stretch',
  },
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  labelIcon: {
    marginRight: 6,
  },
  cardIcon: {
    width: 14,
    height: 20,
    borderRadius: 2,
    marginRight: 6,
  },
  bmSectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#667eea',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 4,
  },
  bmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  bmRowIconWrap: {
    width: 28,
    alignItems: 'center',
    marginRight: 10,
  },
  bmRowText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  bmRowSw: {
    marginHorizontal: 8,
    transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }],
  },
  bmRowIn: {
    width: 62,
    height: 36,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    borderRadius: 8,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    backgroundColor: '#f8f9fa',
    paddingVertical: 0,
    paddingHorizontal: 4,
    includeFontPadding: false,
  },
  bmRowInDisabled: {
    opacity: 0.4,
    backgroundColor: '#f0f0f0',
  },
  // Stili Gestione Mercato
  marketStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  marketStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  marketStatusText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  marketSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    gap: 8,
  },
  marketSearchInput: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    paddingVertical: 0,
  },
  marketEmptyContainer: {
    alignItems: 'center',
    padding: 24,
  },
  marketEmptyText: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
    fontWeight: '500',
  },
  marketEmptyHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  marketFilterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  marketFilterBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#f5f5f5',
  },
  marketFilterBtnActive: {
    backgroundColor: '#667eea18',
    borderColor: '#667eea',
  },
  marketFilterBtnBlocked: {
    backgroundColor: '#dc354518',
    borderColor: '#dc3545',
  },
  marketFilterBtnUnblocked: {
    backgroundColor: '#28a74518',
    borderColor: '#28a745',
  },
  marketFilterText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888',
  },
  marketFilterTextActive: {
    color: '#667eea',
  },
  marketFilterTextBlocked: {
    color: '#dc3545',
  },
  marketFilterTextUnblocked: {
    color: '#28a745',
  },
  marketUserBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  marketUserBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  marketUserList: {
    marginBottom: 12,
  },
  marketUserItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  marketUserInfo: {
    flex: 1,
    marginRight: 12,
  },
  marketUsername: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  marketTeamName: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  marketInfoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#f0f4ff',
    borderRadius: 8,
    padding: 10,
    gap: 8,
    marginBottom: 10,
  },
  marketInfoText: {
    flex: 1,
    fontSize: 12,
    color: '#667eea',
    lineHeight: 16,
  },
  // Stili gestione mercato - stile copiato da gestione utenti
  mktSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  mktSearchIcon: {
    marginRight: 8,
  },
  mktSearchInput: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    padding: 0,
  },
  mktClearButton: {
    marginLeft: 8,
    padding: 4,
  },
  mktFiltersContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  mktFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  mktFilterChipText: {
    fontSize: 11,
    color: '#666',
    fontWeight: '500',
  },
  mktFilterChipTextActive: {
    color: '#fff',
  },
  mktUserList: {
    marginTop: 4,
  },
  mktMemberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  mktMemberInfo: {
    flex: 1,
    marginRight: 12,
  },
  mktMemberHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  mktMemberUsername: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  mktMemberTeam: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  subtitle: {
    fontSize: 11,
    color: '#999',
    marginBottom: 8,
    marginLeft: 24,
  },
  input: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#e8e8e8',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#333',
  },
  timeInputText: {
    fontSize: 15,
    color: '#333',
  },
  saveButton: {
    backgroundColor: '#667eea',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonSuccess: {
    backgroundColor: '#2e7d32',
    shadowColor: '#2e7d32',
  },
  logoContainer: {
    marginTop: 8,
  },
  logoDisplayContainer: {
    alignItems: 'center',
    gap: 12,
  },
  logoImage: {
    width: 150,
    height: 150,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#fff',
  },
  logoLoading: {
    marginTop: 8,
  },
  logoActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    gap: 6,
  },
  logoRemoveButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  logoActionText: {
    fontSize: 14,
    color: '#667eea',
    fontWeight: '600',
  },
  logoRemoveText: {
    color: '#ef4444',
  },
  logoPlaceholder: {
    width: 150,
    height: 150,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderStyle: 'dashed',
    backgroundColor: '#fafafa',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  logoPlaceholderText: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  defaultLogosContainer: {
    marginTop: 12,
    marginBottom: 16,
  },
  defaultLogosTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#555',
    marginBottom: 12,
  },
  defaultLogosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  defaultLogoItem: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#e8e8e8',
    position: 'relative',
  },
  defaultLogoItemSelected: {
    borderColor: '#2e7d32',
    borderWidth: 3,
  },
  defaultLogoCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  defaultLogoEmoji: {
    fontSize: 32,
  },
  defaultLogoCheck: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  customLogoContainer: {
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  customLogoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 12,
  },
  helperText: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  subsectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
    marginTop: 12,
    marginBottom: 10,
  },
  // Stili per profilo squadra
  teamProfileContainer: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 24,
    paddingHorizontal: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  selectedLogoContainer: {
    marginBottom: 20,
    alignItems: 'center',
  },
  selectedLogoCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#e0e0e0',
  },
  selectedLogoImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#667eea',
  },
  selectedLogoEmoji: {
    fontSize: 64,
  },
  logoWrapper: {
    position: 'relative',
  },
  editLogoBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#667eea',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  teamInfoRow: {
    flexDirection: 'row',
    width: '100%',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    alignItems: 'center',
  },
  teamInfoItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  teamInfoInput: {
    flex: 1,
    fontSize: 16,
    color: '#333',
    paddingVertical: 0,
  },
  teamInfoText: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  teamInfoSeparator: {
    width: 1,
    height: 30,
    backgroundColor: '#e0e0e0',
    marginHorizontal: 12,
  },
  // Stili per modal logo
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#f2f3f7',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '80%',
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 18,
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  modalCloseButton: {
    padding: 4,
  },
  modalScrollView: {
    padding: 20,
  },
  customLogoSection: {
    marginTop: 24,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#667eea',
    borderStyle: 'dashed',
    marginTop: 12,
    gap: 8,
  },
  uploadButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#667eea',
  },
  removeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e53935',
    marginTop: 10,
    gap: 8,
  },
  removeButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#e53935',
  },
  roleLimitsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 1,
  },
  roleLimitItem: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 2,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  roleSeparator: {
    width: 0,
  },
  roleLabel: {
    fontSize: 6,
    fontWeight: '700',
    color: '#888',
    marginBottom: 6,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  roleInput: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#e8e8e8',
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    fontWeight: '700',
    width: '85%',
    textAlign: 'center',
    color: '#333',
  },
  // Stili Calcola Giornata
  calcMatchdayPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#fff',
    marginRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  calcMatchdayPillActive: {
    backgroundColor: '#667eea',
  },
  calcMatchdayPillCalculated: {
    backgroundColor: '#e8f5e9',
  },
  calcMatchdayPillCalcActive: {
    backgroundColor: '#198754',
  },
  calcMatchdayPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  calcMatchdayPillTextActive: {
    color: '#fff',
  },
  calcInfoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  calcInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  calcInfoLabel: {
    fontSize: 13,
    color: '#666',
  },
  calcInfoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  calcStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  calcStatusCalc: {
    backgroundColor: '#e8f5e9',
  },
  calcStatusNotCalc: {
    backgroundColor: '#fff3cd',
  },
  calcStatusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  calc6PoliticoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  calcCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calcCheckboxActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  calc6PoliticoText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  calc6PoliticoDesc: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  calcButton: {
    backgroundColor: '#667eea',
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  calcButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  calcFeedback: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f5e9',
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
    gap: 6,
  },
  calcFeedbackText: {
    color: '#198754',
    fontWeight: '600',
    fontSize: 13,
  },
  calcResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 8,
    marginBottom: 4,
  },
  calcResultPos: {
    width: 24,
    fontSize: 13,
    fontWeight: '700',
    color: '#667eea',
  },
  calcResultName: {
    flex: 1,
    fontSize: 13,
    color: '#333',
    fontWeight: '500',
  },
  calcResultScore: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
  },
  modalOverlayCalc: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCardCalc: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '85%',
    alignItems: 'center',
  },
  modalTitleCalc: {
    fontSize: 17,
    fontWeight: '700',
    color: '#333',
    marginTop: 10,
    marginBottom: 6,
  },
  modalDescCalc: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  modalButtonsCalc: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancelBtnCalc: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
  },
  modalConfirmBtnCalc: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#e6a800',
    alignItems: 'center',
  },
  // Confirm modal
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '85%',
    alignItems: 'center',
  },
  confirmIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff5f5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  confirmTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  confirmMessage: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  confirmBtnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
  },
  confirmBtnCancelText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '600',
  },
  confirmBtnAction: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#667eea',
  },
  confirmBtnActionText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Toast
  toast: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 999,
  },
  toastError: {
    backgroundColor: '#e53935',
  },
  toastSuccess: {
    backgroundColor: '#2e7d32',
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
});

