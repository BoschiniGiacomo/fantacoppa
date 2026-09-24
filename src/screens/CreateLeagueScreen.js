import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Switch,
  Animated,
  Platform,
  PanResponder,
  Keyboard,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { leagueService } from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import BonusIcon from '../components/BonusIcon';

const STEPS = [
  { id: 1, title: 'Informazioni', short: 'Info', icon: 'information-circle-outline' },
  { id: 2, title: 'Squadra', short: 'Rosa', icon: 'people-outline' },
  { id: 3, title: 'Bonus', short: 'Punti', icon: 'flash-outline' },
  { id: 4, title: 'Riepilogo', short: 'Crea', icon: 'checkmark-circle-outline' },
];
const CREATE_LEAGUE_DRAFT_KEY = 'create_league_draft_v1';

const SWITCH_TRACK = { false: '#e2e8f0', true: '#a5b4fc' };
const SWITCH_THUMB_OFF = '#f8fafc';
const SWITCH_THUMB_ON = '#667eea';

export default function CreateLeagueScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const scrollViewRef = React.useRef(null);
  const inputLayouts = React.useRef({});
  
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardHeightRef = useRef(0);
  const focusedInputRef = useRef(null);
  const focusedInputKey = useRef(null);
  const scrollOffsetY = useRef(0);
  const [validationToast, setValidationToast] = useState('');
  const [toastMsg, setToastMsg] = useState(null);
  const [highlightField, setHighlightField] = useState(null); // campo da evidenziare
  const [fieldErrors, setFieldErrors] = useState({});
  const fieldRefs = useRef({}); // ref per i container dei campi validabili
  const stepOpacity = useRef(new Animated.Value(1)).current;

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };
  
  const scrollInputIntoView = useCallback((inputNode) => {
    if (!inputNode || !scrollViewRef.current) return;
    if (typeof inputNode.measureInWindow !== 'function') return;
    if (typeof scrollViewRef.current.measureInWindow !== 'function') return;

    const run = () => {
      try {
        const winH = Dimensions.get('window').height || 0;
        const kbH = keyboardHeightRef.current;
        scrollViewRef.current.measureInWindow((sx, sy, sw, sh) => {
          if (!Number.isFinite(sy) || !Number.isFinite(sh) || sh <= 0) return;
          inputNode.measureInWindow((ix, iy, iw, ih) => {
            if (!Number.isFinite(iy) || !Number.isFinite(ih)) return;
            const margin = 28;
            const visibleTop = sy + margin;
            // La ScrollView può misurarsi ancora "dietro" la tastiera: taglia al top tastiera.
            const kbTop = kbH > 0 ? winH - kbH : sy + sh;
            const visibleBottom = Math.min(sy + sh, kbTop) - margin;
            const inputTop = iy;
            const inputBottom = iy + ih;
            let delta = 0;
            if (inputBottom > visibleBottom) {
              delta = inputBottom - visibleBottom;
            } else if (inputTop < visibleTop) {
              delta = inputTop - visibleTop;
            }
            if (delta === 0) return;
            scrollViewRef.current?.scrollTo({
              y: Math.max(0, scrollOffsetY.current + delta),
              animated: true,
            });
          });
        });
      } catch {
        // measure fallita: ignora
      }
    };

    requestAnimationFrame(() => setTimeout(run, 16));
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, (e) => {
      const h = e.endCoordinates?.height || 0;
      keyboardHeightRef.current = h;
      setKeyboardHeight(h);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      keyboardHeightRef.current = 0;
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // Dopo che il padding sotto cresce con la tastiera, riporta il campo in vista.
  useEffect(() => {
    if (keyboardHeight <= 0 || !focusedInputRef.current) return undefined;
    const t1 = setTimeout(() => scrollInputIntoView(focusedInputRef.current), 80);
    const t2 = setTimeout(() => scrollInputIntoView(focusedInputRef.current), 280);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [keyboardHeight, scrollInputIntoView]);

  // Per i malus: forza il segno negativo quando esci dal campo
  const commitMalusValue = (fieldKey) => {
    const text = formData[fieldKey];
    if (text !== undefined && text !== null && text !== '') {
      const cleaned = String(text).replace(',', '.');
      let num = parseFloat(cleaned);
      if (!isNaN(num) && num > 0) {
        setFormData(prev => ({ ...prev, [fieldKey]: (-num).toString() }));
      }
    }
  };

  const handleInputFocus = (inputKey, inputRef) => {
    focusedInputRef.current = inputRef?.current;
    focusedInputKey.current = inputKey;

    const doScroll = () => {
      if (!inputRef?.current) return;
      scrollInputIntoView(inputRef.current);
    };

    setTimeout(doScroll, 100);
    setTimeout(doScroll, 320);
  };

  // Spazio sotto: cresce con la tastiera, torna al padding del footer quando la chiudi.
  const scrollBottomPad =
    keyboardHeight > 0
      ? keyboardHeight + 28
      : 72 + Math.max(insets.bottom, 10);

  const inputRefs = {
    step1: {
      name: React.useRef(null),
      accessCode: React.useRef(null),
      initialBudget: React.useRef(null),
    },
    step2: {
      maxPortieri: React.useRef(null),
      maxDifensori: React.useRef(null),
      maxCentrocampisti: React.useRef(null),
      maxAttaccanti: React.useRef(null),
      numeroTitolari: React.useRef(null),
    },
    step3: {
      bonusGoal: React.useRef(null),
      bonusAssist: React.useRef(null),
      bonusPenaltySaved: React.useRef(null),
      bonusCleanSheet: React.useRef(null),
      malusYellowCard: React.useRef(null),
      malusRedCard: React.useRef(null),
      malusGoalsConceded: React.useRef(null),
      malusOwnGoal: React.useRef(null),
      malusPenaltyMissed: React.useRef(null),
      malusPalloneFuori: React.useRef(null),
      bonusBriso: React.useRef(null),
      malusNoDivisa: React.useRef(null),
    },
  };
  const [formData, setFormData] = useState({
    name: '',
    enableAccessCode: false,
    accessCode: '',
    requireApproval: false,
    initialBudget: '100',
    defaultTime: '20:00',
    maxPortieri: '3',
    maxDifensori: '8',
    maxCentrocampisti: '8',
    maxAttaccanti: '6',
    numeroTitolari: '11',
    autoLineupMode: true,
    hideFormations: false,
    enableBonusMalus: true,
    enableGoal: true,
    bonusGoal: '3.0',
    enableAssist: true,
    bonusAssist: '1.0',
    enableYellowCard: true,
    malusYellowCard: '-0.5',
    enableRedCard: true,
    malusRedCard: '-1.0',
    enableGoalsConceded: true,
    malusGoalsConceded: '-1.0',
    enableOwnGoal: true,
    malusOwnGoal: '-2.0',
    enablePenaltyMissed: true,
    malusPenaltyMissed: '-3.0',
    enablePenaltySaved: true,
    bonusPenaltySaved: '3.0',
    enableCleanSheet: true,
    bonusCleanSheet: '1.0',
    enablePalloneFuori: false,
    malusPalloneFuori: '-0.5',
    enableBriso: false,
    bonusBriso: '1.5',
    enableNoDivisa: false,
    malusNoDivisa: '-1.0',
    linkedToLeagueId: null,
    linkedLeagueName: '',
  });

  // Ensure numeroTitolari is always within range 4-11
  useEffect(() => {
    if (formData && formData.numeroTitolari !== undefined) {
      const currentValue = parseInt(formData.numeroTitolari, 10);
      if (!isNaN(currentValue) && (currentValue < 4 || currentValue > 11)) {
        const clampedValue = Math.min(Math.max(currentValue, 4), 11);
        setFormData((prev) => ({ ...prev, numeroTitolari: clampedValue.toString() }));
      }
    }
  }, [formData?.numeroTitolari]);
  
  const [linkToOfficial, setLinkToOfficial] = useState(false);
  const [officialLeagues, setOfficialLeagues] = useState([]);
  const [loadingOfficialLeagues, setLoadingOfficialLeagues] = useState(false);
  
  // Fetch official leagues when toggle is enabled
  const fetchOfficialLeagues = async () => {
    if (officialLeagues.length > 0) return; // Already loaded
    try {
      setLoadingOfficialLeagues(true);
      const response = await leagueService.getAvailableOfficialLeagues();
      setOfficialLeagues(response.data || []);
    } catch (error) {
      console.error('Error fetching official leagues:', error);
      showToast('Impossibile caricare le leghe ufficiali disponibili', 'error');
    } finally {
      setLoadingOfficialLeagues(false);
    }
  };
  
  // Carica leghe ufficiali disponibili (senza forzare l'associazione).
  useEffect(() => {
    let mounted = true;
    const bootstrapOfficialLeagues = async () => {
      try {
        setLoadingOfficialLeagues(true);
        const response = await leagueService.getAvailableOfficialLeagues();
        if (!mounted) return;
        const leagues = Array.isArray(response.data) ? response.data : [];
        setOfficialLeagues(leagues);
      } catch (error) {
        if (!mounted) return;
        console.error('Error bootstrapping official leagues:', error);
      } finally {
        if (mounted) setLoadingOfficialLeagues(false);
      }
    };
    bootstrapOfficialLeagues();
    return () => { mounted = false; };
  }, []);

  // Fetch official leagues only if user enables toggle and list is still empty
  useEffect(() => {
    if (linkToOfficial && officialLeagues.length === 0) {
      fetchOfficialLeagues();
    }
  }, [linkToOfficial, officialLeagues.length]);
  
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  // Ripristina bozza (se presente) per evitare perdita dati tra step/navigazioni.
  useEffect(() => {
    let mounted = true;
    const loadDraft = async () => {
      try {
        const raw = await AsyncStorage.getItem(CREATE_LEAGUE_DRAFT_KEY);
        if (!mounted || !raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (parsed.formData && typeof parsed.formData === 'object') {
            setFormData((prev) => ({ ...prev, ...parsed.formData }));
          }
          if (typeof parsed.linkToOfficial === 'boolean') {
            setLinkToOfficial(parsed.linkToOfficial);
          }
          if (Number.isFinite(Number(parsed.currentStep))) {
            const s = Math.min(Math.max(Number(parsed.currentStep), 1), STEPS.length);
            setCurrentStep(s);
          }
        }
      } catch (_) {
        // Ignore bozza corrotta/non leggibile.
      } finally {
        if (mounted) setDraftLoaded(true);
      }
    };
    loadDraft();
    return () => { mounted = false; };
  }, []);

  // Salva bozza in modo continuo.
  useEffect(() => {
    if (!draftLoaded) return;
    const payload = {
      formData,
      linkToOfficial,
      currentStep,
    };
    AsyncStorage.setItem(CREATE_LEAGUE_DRAFT_KEY, JSON.stringify(payload)).catch(() => {});
  }, [draftLoaded, formData, linkToOfficial, currentStep]);
  
  // Convert defaultTime string to Date object for picker
  const getTimeDate = () => {
    const [hours, minutes] = formData.defaultTime.split(':').map(Number);
    const date = new Date();
    date.setHours(hours || 20, minutes || 0, 0, 0);
    return date;
  };
  
  const handleTimeChange = (event, selectedTime) => {
    setShowTimePicker(Platform.OS === 'ios');
    const hours = selectedTime.getHours().toString().padStart(2, '0');
    const minutes = selectedTime.getMinutes().toString().padStart(2, '0');
    setFormData({ ...formData, defaultTime: `${hours}:${minutes}` });
  };

  const handleTimeDismiss = () => {
    setShowTimePicker(false);
  };
  
  const handleSliderChange = (value) => {
    const clampedValue = Math.min(Math.max(value, 0), 1000);
    setFormData((prev) => ({ ...prev, initialBudget: clampedValue.toString() }));
  };
  
  const sliderTrackRef = useRef(null);
  const sliderWidth = useRef(300);
  
  const updateSliderValue = (pageX) => {
    if (sliderTrackRef.current) {
      sliderTrackRef.current.measure((x, y, width, height, pageXTrack, pageY) => {
        sliderWidth.current = width;
        const touchX = pageX - pageXTrack;
        const percentage = Math.min(Math.max(touchX / width, 0), 1);
        const value = Math.round(percentage * 1000);
        handleSliderChange(value);
      });
    }
  };
  
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        updateSliderValue(evt.nativeEvent.pageX);
      },
      onPanResponderMove: (evt) => {
        updateSliderValue(evt.nativeEvent.pageX);
      },
      onPanResponderRelease: () => {},
    })
  ).current;

  const handleTitolariChange = (value) => {
    const clampedValue = Math.min(Math.max(value, 4), 11);
    setFormData((prev) => ({ ...prev, numeroTitolari: clampedValue.toString() }));
  };
  
  const titolariSliderTrackRef = useRef(null);
  const titolariSliderWidth = useRef(300);
  
  const updateTitolariSliderValue = (pageX) => {
    if (titolariSliderTrackRef.current) {
      titolariSliderTrackRef.current.measure((x, y, width, height, pageXTrack, pageY) => {
        titolariSliderWidth.current = width;
        const touchX = pageX - pageXTrack;
        const percentage = Math.min(Math.max(touchX / width, 0), 1);
        // Map from 0-1 to 4-11 (7 possible values: 4,5,6,7,8,9,10,11)
        const value = Math.round(4 + (percentage * 7));
        // Ensure value is within range
        const clampedValue = Math.min(Math.max(value, 4), 11);
        handleTitolariChange(clampedValue);
      });
    }
  };
  
  const titolariPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        updateTitolariSliderValue(evt.nativeEvent.pageX);
      },
      onPanResponderMove: (evt) => {
        updateTitolariSliderValue(evt.nativeEvent.pageX);
      },
      onPanResponderRelease: () => {},
    })
  ).current;

  const showValidationError = (message, fieldKey) => {
    setValidationToast(message);
    setHighlightField(fieldKey);
    if (fieldKey) {
      setFieldErrors((prev) => ({ ...prev, [fieldKey]: message }));
    }
    setTimeout(() => setValidationToast(''), 2500);
    setTimeout(() => setHighlightField(null), 3000);

    if (fieldKey && fieldRefs.current[fieldKey] && scrollViewRef.current) {
      fieldRefs.current[fieldKey].measureLayout(
        scrollViewRef.current,
        (x, y) => {
          scrollViewRef.current.scrollTo({ y: Math.max(0, y - 20), animated: true });
        },
        () => {}
      );
    }
  };

  const clearFieldError = (fieldKey) => {
    setFieldErrors((prev) => {
      if (!prev[fieldKey]) return prev;
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  };

  const validateStep = (step) => {
    switch (step) {
      case 1:
        if (!formData.name.trim()) {
          showValidationError('Inserisci il nome della lega', 'name');
          return false;
        }
        if (formData.enableAccessCode && !String(formData.accessCode || '').trim()) {
          showValidationError('Inserisci il codice di accesso, oppure disattivalo', 'accessCode');
          return false;
        }
        if (parseInt(formData.initialBudget, 10) < 1) {
          showValidationError('Il budget deve essere almeno 1', 'budget');
          return false;
        }
        return true;
      case 2:
        if (linkToOfficial && !formData.linkedToLeagueId) {
          showValidationError('Scegli una lega ufficiale da collegare', 'officialLeague');
          return false;
        }
        return true;
      case 3:
        return true;
      default:
        return true;
    }
  };

  const animateToStep = (nextStep) => {
    // Niente fade-out a 0: sullo step Bonus (pesante) lascia lo schermo vuoto
    // mentre monta switch/input/icone. Cambio step subito + fade leggero in entrata.
    stepOpacity.stopAnimation();
    setCurrentStep(nextStep);
    scrollOffsetY.current = 0;
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    });
    stepOpacity.setValue(0.92);
    Animated.timing(stepOpacity, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      if (currentStep < STEPS.length) {
        setFieldErrors({});
        animateToStep(currentStep + 1);
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setFieldErrors({});
      animateToStep(currentStep - 1);
    }
  };

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      showValidationError('Inserisci il nome della lega', 'name');
      return;
    }

    if (parseInt(formData.initialBudget) < 1) {
      showValidationError('Il budget iniziale deve essere almeno 1', 'budget');
      return;
    }

    setLoading(true);
    try {
      const toInt = (value, fallback) => {
        const n = parseInt(value, 10);
        return Number.isFinite(n) ? n : fallback;
      };
      const toFloat = (value, fallback) => {
        const n = parseFloat(String(value ?? '').replace(',', '.'));
        return Number.isFinite(n) ? n : fallback;
      };
      const linkedLeagueId = linkToOfficial ? toInt(formData.linkedToLeagueId, 0) : 0;

      const leagueData = {
        name: formData.name.trim(),
        accessCode: formData.enableAccessCode ? (formData.accessCode.trim() || null) : null,
        requireApproval: formData.requireApproval ? 1 : 0,
        initialBudget: Math.max(1, toInt(formData.initialBudget, 100)),
        defaultTime: formData.defaultTime,
        maxPortieri: Math.max(1, toInt(formData.maxPortieri, 3)),
        maxDifensori: Math.max(1, toInt(formData.maxDifensori, 8)),
        maxCentrocampisti: Math.max(1, toInt(formData.maxCentrocampisti, 8)),
        maxAttaccanti: Math.max(1, toInt(formData.maxAttaccanti, 6)),
        numeroTitolari: Math.min(11, Math.max(4, toInt(formData.numeroTitolari, 11))),
        autoLineupMode: formData.autoLineupMode ? 1 : 0,
        hideFormations: formData.hideFormations ? 1 : 0,
        linked_to_league_id: linkedLeagueId > 0 ? linkedLeagueId : null,
        bonusSettings: formData.enableBonusMalus ? {
          enable_bonus_malus: 1,
          enable_goal: formData.enableGoal ? 1 : 0,
          bonus_goal: toFloat(formData.bonusGoal, 3.0),
          enable_assist: formData.enableAssist ? 1 : 0,
          bonus_assist: toFloat(formData.bonusAssist, 1.0),
          enable_yellow_card: formData.enableYellowCard ? 1 : 0,
          malus_yellow_card: toFloat(formData.malusYellowCard, -0.5),
          enable_red_card: formData.enableRedCard ? 1 : 0,
          malus_red_card: toFloat(formData.malusRedCard, -1.0),
          enable_goals_conceded: formData.enableGoalsConceded ? 1 : 0,
          malus_goals_conceded: toFloat(formData.malusGoalsConceded, -1.0),
          enable_own_goal: formData.enableOwnGoal ? 1 : 0,
          malus_own_goal: toFloat(formData.malusOwnGoal, -2.0),
          enable_penalty_missed: formData.enablePenaltyMissed ? 1 : 0,
          malus_penalty_missed: toFloat(formData.malusPenaltyMissed, -3.0),
          enable_penalty_saved: formData.enablePenaltySaved ? 1 : 0,
          bonus_penalty_saved: toFloat(formData.bonusPenaltySaved, 3.0),
          enable_clean_sheet: formData.enableCleanSheet ? 1 : 0,
          bonus_clean_sheet: toFloat(formData.bonusCleanSheet, 1.0),
          enable_pallone_fuori: formData.enablePalloneFuori ? 1 : 0,
          malus_pallone_fuori: toFloat(formData.malusPalloneFuori, -0.5),
          enable_briso: formData.enableBriso ? 1 : 0,
          bonus_briso: toFloat(formData.bonusBriso, 1.5),
          enable_no_divisa: formData.enableNoDivisa ? 1 : 0,
          malus_no_divisa: toFloat(formData.malusNoDivisa, -1.0),
        } : null,
      };

      const response = await leagueService.create(leagueData);
      const createdLeagueId = response?.data?.id || response?.data?.leagueId;
      
      if (createdLeagueId) {
        await AsyncStorage.removeItem(CREATE_LEAGUE_DRAFT_KEY).catch(() => {});
        navigation.navigate('League', {
          leagueId: createdLeagueId,
          leagueBootstrap: {
            auto_lineup_mode: formData.autoLineupMode ? 1 : 0,
            hide_formations: formData.hideFormations ? 1 : 0,
          },
        });
      } else {
        showToast('Lega creata con successo!', 'success');
        await AsyncStorage.removeItem(CREATE_LEAGUE_DRAFT_KEY).catch(() => {});
        setTimeout(() => navigation.goBack(), 2500);
      }
    } catch (error) {
      const status = error?.response?.status;
      const errorMessage = error.response?.data?.message || error.message || 'Errore durante la creazione della lega';
      // Fallback robusto: alcuni ambienti creano la lega ma rispondono 500
      // in step secondari. Se succede, cerchiamo la lega appena creata e navighiamo.
      if (status === 500) {
        try {
          const allRes = await leagueService.getAll();
          const allLeagues = Array.isArray(allRes?.data) ? allRes.data : [];
          const wantedName = formData.name.trim().toLowerCase();
          const sameName = allLeagues
            .filter((l) => String(l?.name || '').trim().toLowerCase() === wantedName)
            .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));

          const fallbackLeague = sameName[0];
          if (fallbackLeague?.id) {
            showToast('Lega creata con successo!', 'success');
            await AsyncStorage.removeItem(CREATE_LEAGUE_DRAFT_KEY).catch(() => {});
            setTimeout(
              () =>
                navigation.navigate('League', {
                  leagueId: fallbackLeague.id,
                  leagueBootstrap: {
            auto_lineup_mode: formData.autoLineupMode ? 1 : 0,
            hide_formations: formData.hideFormations ? 1 : 0,
          },
                }),
              350
            );
            return;
          }
        } catch (_) {
          // Se anche il fallback fallisce, mostra errore standard.
        }
      }

      showToast(errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  };

  const renderStepIndicator = () => {
    const active = STEPS.find((s) => s.id === currentStep) || STEPS[0];
    const progress = currentStep / STEPS.length;
    return (
      <View style={styles.stepIndicator}>
        <View style={styles.stepProgressMeta}>
          <Text style={styles.stepProgressCount}>
            Passo {currentStep} di {STEPS.length}
          </Text>
          <Text style={styles.stepProgressTitle}>{active.title}</Text>
        </View>
        <View style={styles.stepProgressTrack}>
          <View style={[styles.stepProgressFill, { width: `${progress * 100}%` }]} />
        </View>
        <View style={styles.stepDotsRow}>
          {STEPS.map((step) => {
            const done = currentStep > step.id;
            const on = currentStep === step.id;
            return (
              <View
                key={step.id}
                style={[
                  styles.stepDot,
                  done && styles.stepDotDone,
                  on && styles.stepDotOn,
                ]}
              >
                {done ? (
                  <Ionicons name="checkmark" size={12} color="#fff" />
                ) : (
                  <Text style={[styles.stepDotText, on && styles.stepDotTextOn]}>{step.id}</Text>
                )}
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  const renderStep1 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepDescription}>Nome, accesso e budget per iniziare.</Text>

      <View
        ref={(ref) => { fieldRefs.current.name = ref; }}
        style={[styles.fieldBlock, highlightField === 'name' && styles.highlightField]}
      >
        <Text style={styles.label}>Nome lega</Text>
        <TextInput
          ref={inputRefs.step1.name}
          style={[styles.input, fieldErrors.name && styles.inputError]}
          placeholder="Es. Fanta Coppa amici"
          placeholderTextColor="#94a3b8"
          value={formData.name}
          onChangeText={(text) => {
            clearFieldError('name');
            setFormData({ ...formData, name: text });
          }}
          returnKeyType="next"
          onSubmitEditing={() => {
            if (formData.enableAccessCode && inputRefs.step1.accessCode.current) {
              inputRefs.step1.accessCode.current.focus();
            } else {
              inputRefs.step1.initialBudget.current?.focus();
            }
          }}
          onFocus={() => handleInputFocus('step1.name', inputRefs.step1.name)}
        />
        {fieldErrors.name ? <Text style={styles.fieldErrorText}>{fieldErrors.name}</Text> : null}
      </View>

      <View
        ref={(ref) => { fieldRefs.current.accessCode = ref; }}
        style={[styles.card, highlightField === 'accessCode' && styles.highlightField]}
      >
        <View style={styles.switchGroup}>
          <View style={styles.switchInfo}>
            <Text style={styles.label}>Codice di accesso</Text>
            <Text style={styles.labelHint}>Solo chi ha il codice può entrare</Text>
          </View>
          <Switch
            value={formData.enableAccessCode}
            onValueChange={(value) => {
              clearFieldError('accessCode');
              setFormData({ ...formData, enableAccessCode: value });
            }}
            trackColor={SWITCH_TRACK}
            thumbColor={formData.enableAccessCode ? SWITCH_THUMB_ON : SWITCH_THUMB_OFF}
          />
        </View>
        {formData.enableAccessCode ? (
          <>
            <TextInput
              ref={inputRefs.step1.accessCode}
              style={[styles.input, styles.inputInCard, fieldErrors.accessCode && styles.inputError]}
              placeholder="Scrivi il codice"
              placeholderTextColor="#94a3b8"
              value={formData.accessCode}
              onChangeText={(text) => {
                clearFieldError('accessCode');
                setFormData({ ...formData, accessCode: text });
              }}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step1.initialBudget.current?.focus()}
              onFocus={() => handleInputFocus('step1.accessCode', inputRefs.step1.accessCode)}
            />
            {fieldErrors.accessCode ? (
              <Text style={styles.fieldErrorText}>{fieldErrors.accessCode}</Text>
            ) : null}
          </>
        ) : null}
      </View>

      <View style={styles.card}>
        <View style={styles.switchGroup}>
          <View style={styles.switchInfo}>
            <Text style={styles.label}>Approvazione iscrizioni</Text>
            <Text style={styles.labelHint}>
              {formData.requireApproval ? 'Un admin deve accettare le richieste' : 'Ingresso libero'}
            </Text>
          </View>
          <Switch
            value={formData.requireApproval}
            onValueChange={(value) => setFormData({ ...formData, requireApproval: value })}
            trackColor={SWITCH_TRACK}
            thumbColor={formData.requireApproval ? SWITCH_THUMB_ON : SWITCH_THUMB_OFF}
          />
        </View>
      </View>

      <View
        ref={(ref) => { fieldRefs.current.budget = ref; }}
        style={[styles.fieldBlock, highlightField === 'budget' && styles.highlightField]}
      >
        <Text style={styles.label}>Budget iniziale</Text>
        <Text style={styles.labelHint}>Crediti per ogni giocatore all’inizio</Text>
        <View style={styles.budgetRow}>
          <View style={styles.sliderWrapper} {...panResponder.panHandlers}>
            <View
              ref={sliderTrackRef}
              style={styles.sliderTrack}
              onLayout={(event) => {
                sliderWidth.current = event.nativeEvent.layout.width;
              }}
            >
              <View
                style={[
                  styles.sliderFill,
                  { width: `${((parseInt(formData.initialBudget, 10) || 0) / 1000) * 100}%` },
                ]}
              />
              <View
                style={[
                  styles.sliderThumb,
                  { left: `${((parseInt(formData.initialBudget, 10) || 0) / 1000) * 100}%` },
                ]}
              />
            </View>
            <View style={styles.sliderLabels}>
              <Text style={styles.sliderLabel}>0</Text>
              <Text style={styles.sliderLabel}>1000</Text>
            </View>
          </View>
          <TextInput
            ref={inputRefs.step1.initialBudget}
            style={[styles.input, styles.budgetInput, fieldErrors.budget && styles.inputError]}
            placeholder="100"
            placeholderTextColor="#94a3b8"
            keyboardType="numeric"
            value={formData.initialBudget}
            onChangeText={(text) => {
              clearFieldError('budget');
              const numValue = parseInt(text, 10) || 0;
              const clampedValue = Math.min(Math.max(numValue, 0), 1000);
              setFormData({ ...formData, initialBudget: clampedValue.toString() });
            }}
            returnKeyType="done"
            onSubmitEditing={handleNext}
            onFocus={() => handleInputFocus('step1.initialBudget', inputRefs.step1.initialBudget)}
          />
        </View>
        {fieldErrors.budget ? <Text style={styles.fieldErrorText}>{fieldErrors.budget}</Text> : null}
      </View>
    </View>
  );

  const renderStep2 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepDescription}>Rosa, titolari e lega ufficiale (opzionale).</Text>

      <View
        ref={(ref) => { fieldRefs.current.officialLeague = ref; }}
        style={[styles.card, highlightField === 'officialLeague' && styles.highlightField]}
      >
        <View style={styles.switchGroup}>
          <View style={styles.switchInfo}>
            <View style={styles.switchTitleRow}>
              <Ionicons name="ribbon" size={18} color="#667eea" />
              <Text style={styles.label}>Lega ufficiale</Text>
            </View>
            <Text style={styles.labelHint}>
              Giocatori e voti dalla lega ufficiale
            </Text>
          </View>
          <Switch
            value={linkToOfficial}
            onValueChange={(value) => {
              clearFieldError('officialLeague');
              setLinkToOfficial(value);
              if (value) {
                fetchOfficialLeagues();
                if (!formData.linkedToLeagueId && officialLeagues[0]) {
                  setFormData((prev) => ({
                    ...prev,
                    linkedToLeagueId: officialLeagues[0].id,
                    linkedLeagueName: officialLeagues[0].name || '',
                  }));
                }
              } else {
                setFormData((prev) => ({ ...prev, linkedToLeagueId: null, linkedLeagueName: '' }));
              }
            }}
            trackColor={SWITCH_TRACK}
            thumbColor={linkToOfficial ? SWITCH_THUMB_ON : SWITCH_THUMB_OFF}
          />
        </View>

        {linkToOfficial ? (
          <View style={styles.officialList}>
            {loadingOfficialLeagues ? (
              <ActivityIndicator size="small" color="#667eea" style={{ paddingVertical: 16 }} />
            ) : officialLeagues.length === 0 ? (
              <Text style={styles.emptyOfficialText}>Nessuna lega ufficiale disponibile</Text>
            ) : (
              officialLeagues.map((league) => {
                const isSelected = formData.linkedToLeagueId === league.id;
                return (
                  <TouchableOpacity
                    key={league.id}
                    style={[styles.officialItem, isSelected && styles.officialItemOn]}
                    onPress={() => {
                      clearFieldError('officialLeague');
                      setFormData((prev) => ({
                        ...prev,
                        linkedToLeagueId: league.id,
                        linkedLeagueName: league.name,
                      }));
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={styles.officialItemCopy}>
                      <Text style={styles.officialItemName}>{league.name}</Text>
                      {league.official_group_name ? (
                        <Text style={styles.officialItemGroup}>{league.official_group_name}</Text>
                      ) : null}
                      <Text style={styles.officialItemMeta}>
                        {league.team_count} squadre · {league.player_count} giocatori
                      </Text>
                    </View>
                    <Ionicons
                      name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={isSelected ? '#667eea' : '#cbd5e1'}
                    />
                  </TouchableOpacity>
                );
              })
            )}
            {fieldErrors.officialLeague ? (
              <Text style={styles.fieldErrorText}>{fieldErrors.officialLeague}</Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Rosa massima</Text>
        <View style={styles.roleLimitsRow}>
          <View style={[styles.roleLimitItem, styles.roleLimitItemFirst]}>
            <Text style={styles.roleLimitLabel}>P</Text>
            <TextInput
              ref={inputRefs.step2.maxPortieri}
              style={styles.roleLimitInput}
              keyboardType="numeric"
              value={formData.maxPortieri}
              onChangeText={(text) => setFormData({ ...formData, maxPortieri: text })}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step2.maxDifensori.current?.focus()}
              onFocus={() => handleInputFocus('step2.maxPortieri', inputRefs.step2.maxPortieri)}
            />
          </View>
          <View style={styles.roleLimitSeparator} />
          <View style={styles.roleLimitItem}>
            <Text style={styles.roleLimitLabel}>D</Text>
            <TextInput
              ref={inputRefs.step2.maxDifensori}
              style={styles.roleLimitInput}
              keyboardType="numeric"
              value={formData.maxDifensori}
              onChangeText={(text) => setFormData({ ...formData, maxDifensori: text })}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step2.maxCentrocampisti.current?.focus()}
              onFocus={() => handleInputFocus('step2.maxDifensori', inputRefs.step2.maxDifensori)}
            />
          </View>
          <View style={styles.roleLimitSeparator} />
          <View style={styles.roleLimitItem}>
            <Text style={styles.roleLimitLabel}>C</Text>
            <TextInput
              ref={inputRefs.step2.maxCentrocampisti}
              style={styles.roleLimitInput}
              keyboardType="numeric"
              value={formData.maxCentrocampisti}
              onChangeText={(text) => setFormData({ ...formData, maxCentrocampisti: text })}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step2.maxAttaccanti.current?.focus()}
              onFocus={() => handleInputFocus('step2.maxCentrocampisti', inputRefs.step2.maxCentrocampisti)}
            />
          </View>
          <View style={styles.roleLimitSeparator} />
          <View style={[styles.roleLimitItem, styles.roleLimitItemLast]}>
            <Text style={styles.roleLimitLabel}>A</Text>
            <TextInput
              ref={inputRefs.step2.maxAttaccanti}
              style={styles.roleLimitInput}
              keyboardType="numeric"
              value={formData.maxAttaccanti}
              onChangeText={(text) => setFormData({ ...formData, maxAttaccanti: text })}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step2.numeroTitolari.current?.focus()}
              onFocus={() => handleInputFocus('step2.maxAttaccanti', inputRefs.step2.maxAttaccanti)}
            />
          </View>
        </View>
        <Text style={styles.roleLegend}>P portieri · D difensori · C centrocampisti · A attaccanti</Text>
      </View>

      <View style={styles.fieldBlock}>
        <Text style={styles.label}>Titolari in campo</Text>
        <Text style={styles.labelHint}>Da 4 a 11</Text>
        <View style={styles.budgetRow}>
          <View style={styles.sliderWrapper} {...titolariPanResponder.panHandlers}>
            <View
              ref={titolariSliderTrackRef}
              style={styles.sliderTrack}
              onLayout={(event) => {
                titolariSliderWidth.current = event.nativeEvent.layout.width;
              }}
            >
              <View
                style={[
                  styles.sliderFill,
                  {
                    width: `${(((Math.min(Math.max(parseInt(formData.numeroTitolari, 10) || 11, 4), 11)) - 4) / 7) * 100}%`,
                  },
                ]}
              />
              <View
                style={[
                  styles.sliderThumb,
                  {
                    left: `${(((Math.min(Math.max(parseInt(formData.numeroTitolari, 10) || 11, 4), 11)) - 4) / 7) * 100}%`,
                  },
                ]}
              />
            </View>
            <View style={styles.sliderLabels}>
              <Text style={styles.sliderLabel}>4</Text>
              <Text style={styles.sliderLabel}>11</Text>
            </View>
          </View>
          <TextInput
            ref={inputRefs.step2.numeroTitolari}
            style={[styles.input, styles.budgetInput]}
            keyboardType="numeric"
            value={formData.numeroTitolari}
            onChangeText={(text) => {
              if (text === '' || /^\d*$/.test(text)) {
                setFormData({ ...formData, numeroTitolari: text });
              }
            }}
            onBlur={() => {
              const numValue = parseInt(formData.numeroTitolari, 10);
              if (isNaN(numValue) || numValue < 4 || numValue > 11) {
                const clampedValue = Math.min(Math.max(isNaN(numValue) ? 11 : numValue, 4), 11);
                setFormData((prev) => ({ ...prev, numeroTitolari: clampedValue.toString() }));
              }
            }}
            returnKeyType="done"
            onSubmitEditing={handleNext}
            onFocus={() => handleInputFocus('step2.numeroTitolari', inputRefs.step2.numeroTitolari)}
          />
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.switchGroup}>
          <View style={styles.switchInfo}>
            <Text style={styles.label}>Formazione automatica</Text>
            <Text style={styles.labelHint}>Compila da sola se non schieri</Text>
          </View>
          <Switch
            value={formData.autoLineupMode}
            onValueChange={(value) => setFormData({ ...formData, autoLineupMode: value })}
            trackColor={SWITCH_TRACK}
            thumbColor={formData.autoLineupMode ? SWITCH_THUMB_ON : SWITCH_THUMB_OFF}
          />
        </View>

        <View style={[styles.switchGroup, styles.switchGroupSpaced]}>
          <View style={styles.switchInfo}>
            <Text style={styles.label}>Nascondi rose altrui</Text>
            <Text style={styles.labelHint}>Le formazioni degli altri restano private</Text>
          </View>
          <Switch
            value={!!formData.hideFormations}
            onValueChange={(value) => setFormData({ ...formData, hideFormations: value })}
            trackColor={SWITCH_TRACK}
            thumbColor={formData.hideFormations ? SWITCH_THUMB_ON : SWITCH_THUMB_OFF}
          />
        </View>

        {!formData.autoLineupMode ? (
          <View style={styles.deadlineBlock}>
            <Text style={styles.label}>Scadenza formazioni</Text>
            <Text style={styles.labelHint}>Orario predefinito della giornata</Text>
            <TouchableOpacity
              style={styles.timePickerButton}
              onPress={() => setShowTimePicker(true)}
            >
              <Ionicons name="time-outline" size={20} color="#667eea" />
              <Text style={styles.timePickerText}>{formData.defaultTime}</Text>
              <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
            </TouchableOpacity>
            {showTimePicker ? (
              <DateTimePicker
                value={getTimeDate()}
                mode="time"
                is24Hour
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onValueChange={handleTimeChange}
                onDismiss={handleTimeDismiss}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );

  const renderStep3 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepDescription}>Punti extra: attiva solo ciò che usi.</Text>

      {/* Header con switch abilitazione */}
      <View style={styles.bmFormGroup}>
        <View style={styles.bmLabelContainer}>
          <Ionicons name="trophy-outline" size={18} color="#667eea" style={styles.bmLabelIcon} />
          <Text style={styles.bmLabel}>Bonus/Malus</Text>
          <Switch
            value={formData.enableBonusMalus}
            onValueChange={(value) => setFormData({ ...formData, enableBonusMalus: value })}
            trackColor={SWITCH_TRACK}
            thumbColor={formData.enableBonusMalus ? SWITCH_THUMB_ON : SWITCH_THUMB_OFF}
            style={{ marginLeft: 'auto' }}
          />
        </View>
        <Text style={styles.bmSubtitle}>Abilita o disabilita il sistema bonus/malus per la lega</Text>
      </View>

      {formData.enableBonusMalus && (
        <>
          {/* ===== SEZIONE BONUS ===== */}
          <Text style={styles.bmSectionTitle}>Bonus</Text>

          {/* Gol segnato */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="goal" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Gol segnato</Text>
            <Switch
              value={formData.enableGoal}
              onValueChange={(value) => setFormData({ ...formData, enableGoal: value })}
              trackColor={{ false: '#e0e0e0', true: '#4CAF50' }}
              thumbColor={formData.enableGoal ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.bonusGoal}
              style={[styles.bmRowInput, !formData.enableGoal && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.bonusGoal}
              onChangeText={(text) => setFormData({ ...formData, bonusGoal: text })}
              placeholder="3.0"
              placeholderTextColor="#999"
              editable={formData.enableGoal}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.bonusAssist.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.bonusGoal'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.bonusGoal', inputRefs.step3.bonusGoal)}
            />
          </View>

          {/* Assist */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="assist" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Assist</Text>
            <Switch
              value={formData.enableAssist}
              onValueChange={(value) => setFormData({ ...formData, enableAssist: value })}
              trackColor={{ false: '#e0e0e0', true: '#4CAF50' }}
              thumbColor={formData.enableAssist ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.bonusAssist}
              style={[styles.bmRowInput, !formData.enableAssist && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.bonusAssist}
              onChangeText={(text) => setFormData({ ...formData, bonusAssist: text })}
              placeholder="1.0"
              placeholderTextColor="#999"
              editable={formData.enableAssist}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.bonusPenaltySaved?.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.bonusAssist'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.bonusAssist', inputRefs.step3.bonusAssist)}
            />
          </View>

          {/* Rigore parato */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="penalty_saved" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Rigore parato</Text>
            <Switch
              value={formData.enablePenaltySaved}
              onValueChange={(value) => setFormData({ ...formData, enablePenaltySaved: value })}
              trackColor={{ false: '#e0e0e0', true: '#4CAF50' }}
              thumbColor={formData.enablePenaltySaved ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.bonusPenaltySaved}
              style={[styles.bmRowInput, !formData.enablePenaltySaved && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.bonusPenaltySaved}
              onChangeText={(text) => setFormData({ ...formData, bonusPenaltySaved: text })}
              placeholder="3.0"
              placeholderTextColor="#999"
              editable={formData.enablePenaltySaved}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.bonusCleanSheet?.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.bonusPenaltySaved'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.bonusPenaltySaved', inputRefs.step3.bonusPenaltySaved)}
            />
          </View>

          {/* Clean sheet */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="clean_sheet" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Clean sheet</Text>
            <Switch
              value={formData.enableCleanSheet}
              onValueChange={(value) => setFormData({ ...formData, enableCleanSheet: value })}
              trackColor={{ false: '#e0e0e0', true: '#4CAF50' }}
              thumbColor={formData.enableCleanSheet ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.bonusCleanSheet}
              style={[styles.bmRowInput, !formData.enableCleanSheet && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.bonusCleanSheet}
              onChangeText={(text) => setFormData({ ...formData, bonusCleanSheet: text })}
              placeholder="1.0"
              placeholderTextColor="#999"
              editable={formData.enableCleanSheet}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.bonusBriso?.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.bonusCleanSheet'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.bonusCleanSheet', inputRefs.step3.bonusCleanSheet)}
            />
          </View>

          {/* MVB */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="briso" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>MVB</Text>
            <Switch
              value={formData.enableBriso}
              onValueChange={(value) => setFormData({ ...formData, enableBriso: value })}
              trackColor={{ false: '#e0e0e0', true: '#4CAF50' }}
              thumbColor={formData.enableBriso ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.bonusBriso}
              style={[styles.bmRowInput, !formData.enableBriso && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.bonusBriso}
              onChangeText={(text) => setFormData({ ...formData, bonusBriso: text })}
              placeholder="1.5"
              placeholderTextColor="#999"
              editable={formData.enableBriso}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.malusYellowCard?.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.bonusBriso'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.bonusBriso', inputRefs.step3.bonusBriso)}
            />
          </View>

          {/* ===== SEZIONE MALUS ===== */}
          <Text style={styles.bmSectionTitle}>Malus</Text>

          {/* Cartellino giallo */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="yellow_card" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Cartellino giallo</Text>
            <Switch
              value={formData.enableYellowCard}
              onValueChange={(value) => setFormData({ ...formData, enableYellowCard: value })}
              trackColor={{ false: '#e0e0e0', true: '#e53935' }}
              thumbColor={formData.enableYellowCard ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.malusYellowCard}
              style={[styles.bmRowInput, !formData.enableYellowCard && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.malusYellowCard}
              onChangeText={(text) => setFormData({ ...formData, malusYellowCard: text })}
              onBlur={() => commitMalusValue('malusYellowCard')}
              placeholder="-0.5"
              placeholderTextColor="#999"
              editable={formData.enableYellowCard}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.malusRedCard?.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.malusYellowCard'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.malusYellowCard', inputRefs.step3.malusYellowCard)}
            />
          </View>

          {/* Cartellino rosso */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="red_card" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Cartellino rosso</Text>
            <Switch
              value={formData.enableRedCard}
              onValueChange={(value) => setFormData({ ...formData, enableRedCard: value })}
              trackColor={{ false: '#e0e0e0', true: '#e53935' }}
              thumbColor={formData.enableRedCard ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.malusRedCard}
              style={[styles.bmRowInput, !formData.enableRedCard && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.malusRedCard}
              onChangeText={(text) => setFormData({ ...formData, malusRedCard: text })}
              onBlur={() => commitMalusValue('malusRedCard')}
              placeholder="-1.0"
              placeholderTextColor="#999"
              editable={formData.enableRedCard}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.malusGoalsConceded?.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.malusRedCard'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.malusRedCard', inputRefs.step3.malusRedCard)}
            />
          </View>

          {/* Gol subito */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="goals_conceded" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Gol subito</Text>
            <Switch
              value={formData.enableGoalsConceded}
              onValueChange={(value) => setFormData({ ...formData, enableGoalsConceded: value })}
              trackColor={{ false: '#e0e0e0', true: '#e53935' }}
              thumbColor={formData.enableGoalsConceded ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.malusGoalsConceded}
              style={[styles.bmRowInput, !formData.enableGoalsConceded && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.malusGoalsConceded}
              onChangeText={(text) => setFormData({ ...formData, malusGoalsConceded: text })}
              onBlur={() => commitMalusValue('malusGoalsConceded')}
              placeholder="-1.0"
              placeholderTextColor="#999"
              editable={formData.enableGoalsConceded}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.malusOwnGoal?.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.malusGoalsConceded'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.malusGoalsConceded', inputRefs.step3.malusGoalsConceded)}
            />
          </View>

          {/* Autogol */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="own_goal" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Autogol</Text>
            <Switch
              value={formData.enableOwnGoal}
              onValueChange={(value) => setFormData({ ...formData, enableOwnGoal: value })}
              trackColor={{ false: '#e0e0e0', true: '#e53935' }}
              thumbColor={formData.enableOwnGoal ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.malusOwnGoal}
              style={[styles.bmRowInput, !formData.enableOwnGoal && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.malusOwnGoal}
              onChangeText={(text) => setFormData({ ...formData, malusOwnGoal: text })}
              onBlur={() => commitMalusValue('malusOwnGoal')}
              placeholder="-2.0"
              placeholderTextColor="#999"
              editable={formData.enableOwnGoal}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.malusPenaltyMissed?.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.malusOwnGoal'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.malusOwnGoal', inputRefs.step3.malusOwnGoal)}
            />
          </View>

          {/* Rigore sbagliato */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="penalty_missed" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Rigore sbagliato</Text>
            <Switch
              value={formData.enablePenaltyMissed}
              onValueChange={(value) => setFormData({ ...formData, enablePenaltyMissed: value })}
              trackColor={{ false: '#e0e0e0', true: '#e53935' }}
              thumbColor={formData.enablePenaltyMissed ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.malusPenaltyMissed}
              style={[styles.bmRowInput, !formData.enablePenaltyMissed && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.malusPenaltyMissed}
              onChangeText={(text) => setFormData({ ...formData, malusPenaltyMissed: text })}
              onBlur={() => commitMalusValue('malusPenaltyMissed')}
              placeholder="-3.0"
              placeholderTextColor="#999"
              editable={formData.enablePenaltyMissed}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.malusPalloneFuori?.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.malusPenaltyMissed'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.malusPenaltyMissed', inputRefs.step3.malusPenaltyMissed)}
            />
          </View>

          {/* Pallone fuori */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="pallone_fuori" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Pallone fuori</Text>
            <Switch
              value={formData.enablePalloneFuori}
              onValueChange={(value) => setFormData({ ...formData, enablePalloneFuori: value })}
              trackColor={{ false: '#e0e0e0', true: '#e53935' }}
              thumbColor={formData.enablePalloneFuori ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.malusPalloneFuori}
              style={[styles.bmRowInput, !formData.enablePalloneFuori && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.malusPalloneFuori}
              onChangeText={(text) => setFormData({ ...formData, malusPalloneFuori: text })}
              onBlur={() => commitMalusValue('malusPalloneFuori')}
              placeholder="-0.5"
              placeholderTextColor="#999"
              editable={formData.enablePalloneFuori}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.malusNoDivisa?.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.malusPalloneFuori'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.malusPalloneFuori', inputRefs.step3.malusPalloneFuori)}
            />
          </View>

          {/* No divisa */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="no_divisa" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>No divisa</Text>
            <Switch
              value={formData.enableNoDivisa}
              onValueChange={(value) => setFormData({ ...formData, enableNoDivisa: value })}
              trackColor={{ false: '#e0e0e0', true: '#e53935' }}
              thumbColor={formData.enableNoDivisa ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.malusNoDivisa}
              style={[styles.bmRowInput, !formData.enableNoDivisa && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.malusNoDivisa}
              onChangeText={(text) => setFormData({ ...formData, malusNoDivisa: text })}
              onBlur={() => commitMalusValue('malusNoDivisa')}
              placeholder="-1.0"
              placeholderTextColor="#999"
              editable={formData.enableNoDivisa}
              returnKeyType="done"
              onSubmitEditing={handleNext}
              onLayout={(e) => { inputLayouts.current['step3.malusNoDivisa'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.malusNoDivisa', inputRefs.step3.malusNoDivisa)}
            />
          </View>
        </>
      )}
    </View>
  );

  const renderStep4 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepDescription}>Controlla e crea la lega.</Text>

      <View style={styles.summaryCard}>
        <View style={styles.summarySection}>
          <Text style={styles.summaryTitle}>Base</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Nome</Text>
            <Text style={styles.summaryValue}>{formData.name || '—'}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Accesso</Text>
            <Text style={styles.summaryValue}>
              {formData.enableAccessCode
                ? (formData.accessCode.trim() || 'Codice vuoto')
                : 'Pubblica'}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Iscrizioni</Text>
            <Text style={styles.summaryValue}>
              {formData.requireApproval ? 'Con approvazione' : 'Libere'}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Budget</Text>
            <Text style={styles.summaryValue}>{formData.initialBudget}</Text>
          </View>
        </View>

        <View style={styles.summarySection}>
          <Text style={styles.summaryTitle}>Squadra</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Ruoli</Text>
            <Text style={styles.summaryValue}>
              P:{formData.maxPortieri} D:{formData.maxDifensori} C:{formData.maxCentrocampisti} A:{formData.maxAttaccanti}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Titolari</Text>
            <Text style={styles.summaryValue}>{formData.numeroTitolari}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Formazione auto</Text>
            <Text style={styles.summaryValue}>
              {formData.autoLineupMode ? 'Sì' : 'No'}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Rose altrui</Text>
            <Text style={styles.summaryValue}>
              {formData.hideFormations ? 'Nascoste' : 'Visibili'}
            </Text>
          </View>
          {!formData.autoLineupMode ? (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Scadenza</Text>
              <Text style={styles.summaryValue}>{formData.defaultTime}</Text>
            </View>
          ) : null}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Lega ufficiale</Text>
            <Text style={[styles.summaryValue, linkToOfficial && styles.summaryValueAccent]}>
              {linkToOfficial ? (formData.linkedLeagueName || 'Da scegliere') : 'No'}
            </Text>
          </View>
        </View>

        <View style={[styles.summarySection, { marginBottom: 0 }]}>
          <Text style={styles.summaryTitle}>Bonus/Malus</Text>
          {!formData.enableBonusMalus ? (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Sistema</Text>
              <Text style={styles.summaryValue}>Disabilitato</Text>
            </View>
          ) : (
            <View style={styles.summaryBonusWrap}>
              {formData.enableGoal && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="goal" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#4CAF50' }]}>+{formData.bonusGoal}</Text>
                </View></View>
              )}
              {formData.enableAssist && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="assist" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#4CAF50' }]}>+{formData.bonusAssist}</Text>
                </View></View>
              )}
              {formData.enablePenaltySaved && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="penalty_saved" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#4CAF50' }]}>+{formData.bonusPenaltySaved}</Text>
                </View></View>
              )}
              {formData.enableCleanSheet && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="clean_sheet" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#4CAF50' }]}>+{formData.bonusCleanSheet}</Text>
                </View></View>
              )}
              {formData.enableBriso && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="briso" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#4CAF50' }]}>+{formData.bonusBriso}</Text>
                </View></View>
              )}
              {formData.enableYellowCard && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="yellow_card" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#e53935' }]}>{formData.malusYellowCard}</Text>
                </View></View>
              )}
              {formData.enableRedCard && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="red_card" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#e53935' }]}>{formData.malusRedCard}</Text>
                </View></View>
              )}
              {formData.enableGoalsConceded && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="goals_conceded" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#e53935' }]}>{formData.malusGoalsConceded}</Text>
                </View></View>
              )}
              {formData.enableOwnGoal && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="own_goal" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#e53935' }]}>{formData.malusOwnGoal}</Text>
                </View></View>
              )}
              {formData.enablePenaltyMissed && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="penalty_missed" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#e53935' }]}>{formData.malusPenaltyMissed}</Text>
                </View></View>
              )}
              {formData.enablePalloneFuori && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="pallone_fuori" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#e53935' }]}>{formData.malusPalloneFuori}</Text>
                </View></View>
              )}
              {formData.enableNoDivisa && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="no_divisa" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#e53935' }]}>{formData.malusNoDivisa}</Text>
                </View></View>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 1:
        return renderStep1();
      case 2:
        return renderStep2();
      case 3:
        return renderStep3();
      case 4:
        return renderStep4();
      default:
        return renderStep1();
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color="#0f172a" />
        </TouchableOpacity>
        <Text style={styles.title}>Crea lega</Text>
        <View style={styles.headerSpacer} />
      </View>

      {renderStepIndicator()}

      <View style={styles.keyboardAvoidingView}>
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: scrollBottomPad },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScroll={(e) => {
            scrollOffsetY.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
        >
          <Animated.View style={{ opacity: stepOpacity }}>
            {renderCurrentStep()}
          </Animated.View>
        </ScrollView>
      </View>

      {keyboardHeight <= 0 ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          {currentStep > 1 ? (
            <TouchableOpacity style={styles.footerButtonSecondary} onPress={handleBack} activeOpacity={0.8}>
              <Text style={styles.footerButtonSecondaryText}>Indietro</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.footerButtonGhost} />
          )}
          {currentStep < STEPS.length ? (
            <TouchableOpacity style={styles.footerButton} onPress={handleNext} activeOpacity={0.85}>
              <Text style={styles.footerButtonText}>Continua</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.footerButton, styles.footerButtonCreate, loading && styles.buttonDisabled]}
              onPress={handleCreate}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.footerButtonText}>Crea lega</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      ) : null}

      {validationToast !== '' ? (
        <View style={[styles.validationToast, { top: Math.max(insets.top, 8) + 56 }]}>
          <Ionicons name="alert-circle" size={18} color="#fff" />
          <Text style={styles.validationToastText}>{validationToast}</Text>
        </View>
      ) : null}

      {toastMsg ? (
        <View
          style={[
            styles.generalToast,
            toastMsg.type === 'success' ? styles.generalToastSuccess : styles.generalToastError,
            { top: Math.max(insets.top, 8) + 56 },
          ]}
        >
          <Ionicons
            name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'}
            size={18}
            color="#fff"
          />
          <Text style={styles.generalToastText}>{toastMsg.text}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.2,
  },
  stepIndicator: {
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  stepProgressMeta: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  stepProgressCount: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  stepProgressTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  stepProgressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
    marginBottom: 12,
  },
  stepProgressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#667eea',
  },
  stepDotsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotDone: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  stepDotOn: {
    backgroundColor: '#eef2ff',
    borderColor: '#667eea',
  },
  stepDotText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
  },
  stepDotTextOn: {
    color: '#667eea',
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  stepContent: {
    padding: 16,
  },
  stepDescription: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
    marginBottom: 16,
    lineHeight: 20,
  },
  fieldBlock: {
    marginBottom: 14,
  },
  fieldErrorText: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
    color: '#dc2626',
  },
  inputError: {
    borderColor: '#fca5a5',
    backgroundColor: '#fff7f7',
  },
  highlightField: {
    borderRadius: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  labelHint: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 8,
    lineHeight: 16,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0f172a',
  },
  inputInCard: {
    marginTop: 10,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 12,
  },
  switchGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  switchGroupSpaced: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eef2f7',
  },
  switchInfo: {
    flex: 1,
  },
  switchTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  officialList: {
    marginTop: 12,
    gap: 8,
  },
  emptyOfficialText: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    paddingVertical: 12,
  },
  officialItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  officialItemOn: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  officialItemCopy: {
    flex: 1,
    marginRight: 8,
  },
  officialItemName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  officialItemGroup: {
    fontSize: 12,
    color: '#667eea',
    fontWeight: '600',
    marginTop: 2,
  },
  officialItemMeta: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  roleLegend: {
    marginTop: 10,
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
  },
  deadlineBlock: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eef2f7',
  },
  summaryValueAccent: {
    color: '#667eea',
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
  },
  footerButtonGhost: {
    width: 100,
  },
  footerButtonSecondary: {
    minWidth: 100,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  footerButtonSecondaryText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#475569',
  },
  footerButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#667eea',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerButtonCreate: {
    backgroundColor: '#198754',
  },
  footerButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  // keep legacy keys used by remaining step3/bonus markup
  stepItem: {
    alignItems: 'center',
    minWidth: 60,
  },
  stepCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e0e0e0',
  },
  stepCircleActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  stepLabel: {
    fontSize: 10,
    color: '#667eea',
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
  },
  stepLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#e0e0e0',
    marginHorizontal: 8,
    maxWidth: 40,
  },
  stepLineActive: {
    backgroundColor: '#667eea',
  },
  step1Content: {
    padding: 16,
  },
  step1Description: {
    marginBottom: 12,
  },
  step1InputGroup: {
    marginBottom: 12,
  },
  stepHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 12,
    marginBottom: 8,
  },
  stepDescription: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
    marginBottom: 16,
    lineHeight: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  budgetHeader: {
    marginBottom: 4,
  },
  budgetRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  sliderWrapper: {
    flex: 1,
    marginVertical: 12,
  },
  step1SliderWrapper: {
    marginVertical: 8,
  },
  sliderTrack: {
    height: 6,
    backgroundColor: '#e0e0e0',
    borderRadius: 3,
    position: 'relative',
    marginBottom: 8,
  },
  sliderFill: {
    height: 6,
    backgroundColor: '#667eea',
    borderRadius: 3,
    position: 'absolute',
    left: 0,
    top: 0,
  },
  sliderThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#667eea',
    position: 'absolute',
    top: -7,
    marginLeft: -10,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sliderLabel: {
    fontSize: 12,
    color: '#999',
  },
  budgetInput: {
    width: 80,
    marginTop: 0,
    marginBottom: 12,
  },
  timePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    gap: 12,
  },
  step1TimePickerButton: {
    padding: 12,
  },
  timePickerText: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  step1Label: {
    fontSize: 14,
    marginBottom: 4,
  },
  labelHint: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 8,
    lineHeight: 16,
  },
  step1LabelHint: {
    fontSize: 12,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    color: '#0f172a',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  halfInput: {
    flex: 1,
  },
  cardTitleContainer: {
    marginBottom: 8,
  },
  roleLimitsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  roleLimitItem: {
    flex: 1,
    alignItems: 'center',
  },
  roleLimitLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 6,
    textAlign: 'center',
  },
  roleLimitItemFirst: {
    paddingLeft: 0,
  },
  roleLimitItemLast: {
    paddingRight: 0,
  },
  roleLimitInput: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    fontSize: 15,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: '#dbe3ef',
    color: '#0f172a',
    textAlign: 'center',
    minWidth: 50,
  },
  roleLimitSeparator: {
    width: StyleSheet.hairlineWidth,
    height: 40,
    backgroundColor: '#e2e8f0',
    marginHorizontal: 2,
  },
  switchGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  switchInfo: {
    flex: 1,
  },
  bonusSection: {
    marginBottom: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  bonusGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  bonusGridItem: {
    flex: 1,
    backgroundColor: '#fafafa',
    borderRadius: 10,
    borderWidth: 1.5,
    padding: 10,
  },
  bmFormGroup: {
    marginBottom: 16,
  },
  bmFormGroupRow: {
    flexDirection: 'row',
    marginBottom: 16,
    alignItems: 'flex-start',
  },
  bmFormGroupHalf: {
    flex: 1,
  },
  bmFormGroupSeparator: {
    width: 1,
    backgroundColor: '#ddd',
    marginHorizontal: 8,
    alignSelf: 'stretch',
  },
  bmLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  bmLabelIcon: {
    marginRight: 4,
  },
  bmLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    flexShrink: 1,
  },
  bmSubtitle: {
    fontSize: 11,
    color: '#666',
    marginBottom: 8,
    marginLeft: 24,
  },
  bmSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#667eea',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 4,
  },
  bmSwitch: {
    marginLeft: 'auto',
    transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }],
  },
  bmRowFull: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  bmRowIcon: {
    width: 28,
    alignItems: 'center',
    marginRight: 10,
  },
  bmRowLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  bmRowSwitch: {
    marginHorizontal: 8,
    transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }],
  },
  bmRowInput: {
    width: 62,
    height: 38,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    backgroundColor: '#f8f9fa',
    paddingVertical: 0,
    paddingHorizontal: 4,
    includeFontPadding: false,
  },
  bmRowInputDisabled: {
    opacity: 0.4,
    backgroundColor: '#f0f0f0',
  },
  bmCardIcon: {
    width: 14,
    height: 20,
    borderRadius: 2,
    marginRight: 6,
  },
  bmInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    color: '#333',
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  summarySection: {
    marginBottom: 14,
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
    marginBottom: 6,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  summaryLabel: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: 13,
    color: '#333',
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  summaryBonusWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    marginHorizontal: -3,
  },
  summaryBonusChip: {
    width: '25%',
    paddingHorizontal: 3,
    paddingVertical: 3,
  },
  summaryBonusChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 4,
  },
  summaryBonusVal: {
    fontSize: 13,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
  },
  footerButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#667eea',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerButtonPrimary: {
    backgroundColor: '#198754',
  },
  footerButtonSecondary: {
    minWidth: 100,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  footerButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  footerButtonSecondaryText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#475569',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  highlightField: {
    borderWidth: 1.5,
    borderColor: '#fca5a5',
    borderRadius: 12,
    backgroundColor: '#fff7f7',
    padding: 4,
  },
  validationToast: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: '#dc2626',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 50,
    elevation: 10,
  },
  validationToastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  generalToast: {
    position: 'absolute',
    left: 16,
    right: 16,
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
  generalToastError: {
    backgroundColor: '#e53935',
  },
  generalToastSuccess: {
    backgroundColor: '#4CAF50',
  },
  generalToastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
});
