import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

function formatTrophyYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return '—';
  return `'${String(y).slice(-2)}`;
}

function YearPlaque({ year }) {
  return (
    <View style={styles.plaque}>
      <View style={styles.plaqueInner}>
        <Text style={styles.plaqueYear}>{formatTrophyYear(year)}</Text>
      </View>
    </View>
  );
}

function ChampionshipTrophyVisual() {
  return (
    <View style={styles.champVisual}>
      <View style={styles.champHalo} />
      <Ionicons name="star" size={11} color="#fff8dc" style={styles.champStar} />
      <View style={styles.champHandleLeft} />
      <View style={styles.champHandleRight} />
      <View style={styles.champBowl}>
        <View style={styles.champBowlShine} />
      </View>
      <View style={styles.champNeck} />
      <View style={styles.champPedestal}>
        <View style={styles.champPedestalTop} />
        <View style={styles.champPedestalBase} />
      </View>
    </View>
  );
}

function WineTrophyVisual() {
  return (
    <View style={styles.wineVisual}>
      <View style={styles.wineAura} />
      <View style={styles.wineCupWrap}>
        <View style={styles.wineHandleLeft} />
        <View style={styles.wineHandleRight} />
        <View style={styles.wineCupOuter}>
          <View style={styles.wineCupRim} />
          <View style={styles.wineCupInner}>
            <View style={styles.wineLiquidBody}>
              <View style={styles.wineLiquidSurface} />
              <View style={styles.wineLiquidGlow} />
            </View>
            <View style={styles.wineGrapeMedallion}>
              <View style={styles.wineGrapeHalo} />
              <MaterialCommunityIcons name="fruit-grapes" size={17} color="#f0d4e4" />
            </View>
            <View style={styles.wineCupShineLeft} />
            <View style={styles.wineCupShineRight} />
          </View>
        </View>
      </View>
      <View style={styles.wineStem}>
        <View style={styles.wineStemRing} />
      </View>
      <View style={styles.winePlinth}>
        <View style={styles.winePlinthCap} />
        <View style={styles.winePlinthBody}>
          <View style={styles.winePlinthInset} />
        </View>
      </View>
    </View>
  );
}

function TrophySlot({ type, year }) {
  const isWine = type === 'wine';
  return (
    <View style={styles.slot}>
      <View style={[styles.slotPedestal, isWine ? styles.slotPedestalWine : styles.slotPedestalChamp]}>
        {isWine ? <WineTrophyVisual /> : <ChampionshipTrophyVisual />}
      </View>
      <YearPlaque year={year} />
    </View>
  );
}

function TrophyShelf({ title, subtitle, icon, iconColor, trophies, type, emptyHint, useMciIcon = false }) {
  return (
    <View style={styles.shelfBlock}>
      <View style={styles.shelfHeader}>
        <View style={[styles.shelfIconWrap, type === 'wine' ? styles.shelfIconWrapWine : styles.shelfIconWrapChamp]}>
          {useMciIcon ? (
            <MaterialCommunityIcons name={icon} size={16} color={iconColor} />
          ) : (
            <Ionicons name={icon} size={16} color={iconColor} />
          )}
        </View>
        <View style={styles.shelfHeaderText}>
          <Text style={styles.shelfTitle}>{title}</Text>
          <Text style={styles.shelfSubtitle}>{subtitle}</Text>
        </View>
        <Text style={styles.shelfCount}>{trophies.length}</Text>
      </View>
      <View style={[styles.shelfSurface, type === 'wine' ? styles.shelfSurfaceWine : styles.shelfSurfaceChamp]}>
        <View style={styles.shelfLip} />
        {trophies.length > 0 ? (
          <View style={styles.shelfGrid}>
            {trophies.map((t) => (
              <TrophySlot key={`${type}-${t.year}`} type={type} year={t.year} />
            ))}
          </View>
        ) : (
          <Text style={styles.shelfEmpty}>{emptyHint}</Text>
        )}
      </View>
    </View>
  );
}

export default function OfficialTeamTrophyBoard({ championships = [], wineTrophies = [] }) {
  const champList = Array.isArray(championships) ? championships : [];
  const wineList = Array.isArray(wineTrophies) ? wineTrophies : [];
  const total = champList.length + wineList.length;

  if (total === 0) {
    return (
      <View style={styles.emptyCabinet}>
        <View style={styles.emptyGlow} />
        <MaterialCommunityIcons name="trophy-outline" size={48} color="#5c4a3a" />
        <Text style={styles.emptyTitle}>Bacheca vuota</Text>
        <Text style={styles.emptyText}>I trofei conquistati appariranno qui,{'\n'}sopra la targhetta dell&apos;anno.</Text>
      </View>
    );
  }

  return (
    <View style={styles.cabinet}>
      <View style={styles.cabinetTopTrim} />
      <View style={styles.cabinetInner}>
        <TrophyShelf
          title="Campionato"
          subtitle="Vittoria in finale"
          icon="trophy"
          iconColor="#f5d76e"
          trophies={champList}
          type="championship"
          emptyHint="Nessun titolo in bacheca"
        />
        <TrophyShelf
          title="Trofeo del vino"
          subtitle="Coppa enologica"
          icon="glass-wine"
          iconColor="#e8b4bc"
          trophies={wineList}
          type="wine"
          emptyHint="Nessun trofeo del vino"
          useMciIcon
        />
      </View>
      <View style={styles.cabinetBottomTrim} />
    </View>
  );
}

const styles = StyleSheet.create({
  cabinet: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1a120c',
    borderWidth: 1,
    borderColor: '#3d2e1f',
  },
  cabinetTopTrim: {
    height: 4,
    backgroundColor: '#8b6914',
  },
  cabinetBottomTrim: {
    height: 3,
    backgroundColor: '#2a1f14',
  },
  cabinetInner: {
    padding: 14,
    gap: 18,
    backgroundColor: '#221810',
  },
  shelfBlock: {
    gap: 8,
  },
  shelfHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  shelfIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  shelfIconWrapChamp: {
    backgroundColor: '#3d3018',
    borderColor: '#6b5420',
  },
  shelfIconWrapWine: {
    backgroundColor: '#3a1824',
    borderColor: '#6b2a40',
  },
  shelfHeaderText: {
    flex: 1,
  },
  shelfTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#f5e6c8',
    letterSpacing: 0.3,
  },
  shelfSubtitle: {
    fontSize: 11,
    color: '#8a7358',
    marginTop: 1,
  },
  shelfCount: {
    fontSize: 20,
    fontWeight: '800',
    color: '#5c4a38',
    fontVariant: ['tabular-nums'],
  },
  shelfSurface: {
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 10,
    minHeight: 130,
    borderWidth: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  shelfSurfaceChamp: {
    backgroundColor: '#2e2418',
    borderColor: '#4a3a24',
  },
  shelfSurfaceWine: {
    backgroundColor: '#261418',
    borderColor: '#4a2030',
  },
  shelfLip: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 1,
  },
  shelfGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 14,
  },
  shelfEmpty: {
    textAlign: 'center',
    color: '#6b5a48',
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 24,
  },
  slot: {
    alignItems: 'center',
    width: 78,
    gap: 8,
  },
  slotPedestal: {
    width: 72,
    height: 88,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 6,
    borderWidth: 1,
  },
  slotPedestalChamp: {
    backgroundColor: '#1f1810',
    borderColor: '#3d3018',
  },
  slotPedestalWine: {
    backgroundColor: '#140c10',
    borderColor: '#4a2840',
  },
  plaque: {
    paddingHorizontal: 2,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#6b5420',
    borderWidth: 1,
    borderColor: '#a8842a',
    minWidth: 44,
    alignItems: 'center',
  },
  plaqueInner: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: '#c9a227',
    borderWidth: 1,
    borderColor: '#8b6914',
  },
  plaqueYear: {
    fontSize: 12,
    fontWeight: '900',
    color: '#2a1a05',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
  },
  champVisual: {
    width: 52,
    height: 72,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  champHalo: {
    position: 'absolute',
    top: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(245, 215, 110, 0.15)',
  },
  champStar: {
    position: 'absolute',
    top: 8,
    zIndex: 3,
  },
  champHandleLeft: {
    position: 'absolute',
    top: 22,
    left: 4,
    width: 8,
    height: 18,
    borderWidth: 2,
    borderColor: '#d4af37',
    borderRightWidth: 0,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  champHandleRight: {
    position: 'absolute',
    top: 22,
    right: 4,
    width: 8,
    height: 18,
    borderWidth: 2,
    borderColor: '#d4af37',
    borderLeftWidth: 0,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  champBowl: {
    width: 38,
    height: 22,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: '#e8c547',
    borderWidth: 1,
    borderColor: '#b8860b',
    overflow: 'hidden',
    zIndex: 2,
  },
  champBowlShine: {
    position: 'absolute',
    top: 3,
    left: 6,
    width: 10,
    height: 8,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  champNeck: {
    width: 10,
    height: 6,
    backgroundColor: '#c9a227',
    marginTop: -1,
    zIndex: 1,
  },
  champPedestal: {
    alignItems: 'center',
    marginTop: 2,
  },
  champPedestalTop: {
    width: 22,
    height: 5,
    backgroundColor: '#d4af37',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  champPedestalBase: {
    width: 32,
    height: 8,
    backgroundColor: '#8b6914',
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    borderWidth: 1,
    borderColor: '#6b5420',
    borderTopWidth: 0,
  },
  wineVisual: {
    width: 56,
    height: 76,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  wineAura: {
    position: 'absolute',
    top: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(140, 40, 70, 0.22)',
    shadowColor: '#c45c7a',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  wineCupWrap: {
    width: 50,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  wineHandleLeft: {
    position: 'absolute',
    left: 0,
    top: 8,
    width: 10,
    height: 22,
    borderWidth: 2,
    borderColor: '#9a4a62',
    borderRightWidth: 0,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    opacity: 0.85,
  },
  wineHandleRight: {
    position: 'absolute',
    right: 0,
    top: 8,
    width: 10,
    height: 22,
    borderWidth: 2,
    borderColor: '#9a4a62',
    borderLeftWidth: 0,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    opacity: 0.85,
  },
  wineCupOuter: {
    width: 36,
    height: 34,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#b86a84',
    backgroundColor: '#5a2038',
    overflow: 'hidden',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  wineCupRim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 5,
    backgroundColor: 'rgba(255,220,230,0.18)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  wineCupInner: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
    paddingBottom: 3,
  },
  wineLiquidBody: {
    ...StyleSheet.absoluteFillObject,
    top: 14,
    backgroundColor: '#4a1028',
  },
  wineLiquidSurface: {
    position: 'absolute',
    top: 0,
    left: -4,
    right: -4,
    height: 7,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    backgroundColor: '#7a1f42',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,180,200,0.35)',
  },
  wineLiquidGlow: {
    position: 'absolute',
    bottom: 4,
    left: 6,
    width: 14,
    height: 8,
    borderRadius: 7,
    backgroundColor: 'rgba(255,120,160,0.12)',
  },
  wineGrapeMedallion: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(90, 30, 50, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(230, 170, 190, 0.35)',
    zIndex: 4,
  },
  wineGrapeHalo: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 200, 220, 0.1)',
  },
  wineCupShineLeft: {
    position: 'absolute',
    top: 8,
    left: 5,
    width: 4,
    height: 14,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
    zIndex: 5,
  },
  wineCupShineRight: {
    position: 'absolute',
    top: 12,
    right: 6,
    width: 2,
    height: 8,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    zIndex: 5,
  },
  wineStem: {
    width: 5,
    height: 12,
    marginTop: 1,
    backgroundColor: '#8a4560',
    borderRadius: 2,
    alignItems: 'center',
    zIndex: 1,
  },
  wineStemRing: {
    position: 'absolute',
    top: 3,
    width: 9,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#c47a94',
  },
  winePlinth: {
    alignItems: 'center',
    marginTop: 1,
  },
  winePlinthCap: {
    width: 18,
    height: 3,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    backgroundColor: '#9a5a72',
  },
  winePlinthBody: {
    width: 34,
    height: 9,
    borderRadius: 3,
    backgroundColor: '#2a1420',
    borderWidth: 1,
    borderColor: '#5c3048',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  winePlinthInset: {
    width: 22,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  emptyCabinet: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    borderRadius: 16,
    backgroundColor: '#221810',
    borderWidth: 1,
    borderColor: '#3d2e1f',
    overflow: 'hidden',
  },
  emptyGlow: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(139, 105, 20, 0.08)',
    top: 20,
  },
  emptyTitle: {
    marginTop: 14,
    fontSize: 16,
    fontWeight: '800',
    color: '#c9a87c',
  },
  emptyText: {
    marginTop: 8,
    fontSize: 13,
    color: '#6b5a48',
    textAlign: 'center',
    lineHeight: 19,
  },
});
