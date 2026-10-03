import { Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'
import { Button } from '@/components/ui'
import { withAlpha, type BrandTheme } from '@/theme/brand'
import { color, elevation, radius, space } from '@/theme/tokens'
import { dayParts, dayRange, figure, greeting, initials } from '@/utils/format'
import { SchoolImage, useBrand } from './api'
import { blocksOf, heroOf, type Block, type SchoolHome } from './model'

// School Home, drawn natively: the school's own photograph and colours lead, and each section has its own shape.
// It is read-only and holds no personal records. Sections the school left empty are simply not here.
const SERIF = Platform.select({ ios: 'Georgia', default: 'serif' })

function Heading({ overline, title, brand, inverse }: { overline: string, title: string, brand: BrandTheme, inverse?: boolean }) {
  return <View style={styles.heading}><View style={styles.overlineRow}><View style={[styles.rule, { backgroundColor: brand.accent }]} />
    <Text style={[styles.overline, { color: inverse ? brand.muted : brand.primary }]}>{overline}</Text></View>
    <Text accessibilityRole="header" style={[styles.title, inverse && { color: '#ffffff' }]}>{title}</Text></View>
}

function Section({ block, brand, schoolName }: { block: Block, brand: BrandTheme, schoolName: string }) {
  switch (block.key) {
    case 'statistics': return <View style={styles.glanceWrap}><View style={styles.glance}>{block.items.map((item, i) => <View key={i} style={styles.glanceItem}>
      <Text style={[styles.glanceValue, { color: brand.primary }]} numberOfLines={1} adjustsFontSizeToFit>{figure(item.value)}</Text><Text style={styles.glanceLabel}>{item.label}</Text></View>)}</View></View>
    case 'identity': return <View style={styles.section}><Heading overline="Our purpose" title={block.vision && block.mission ? 'Vision & mission' : block.vision ? 'Our vision' : 'Our mission'} brand={brand} />
      {[['Vision', block.vision], ['Mission', block.mission]].filter(([, text]) => text).map(([label, text]) => <View key={label} style={[styles.purpose, { borderLeftColor: brand.accent }]}>
        <Text style={[styles.purposeLabel, { color: brand.primary }]}>{label}</Text><Text style={styles.purposeText}>{text}</Text></View>)}</View>
    case 'principal': return <View style={[styles.section, { backgroundColor: brand.tint }]}>
      {!!block.photoId && <SchoolImage id={block.photoId} position={block.photoPosition} label={block.name || 'Principal'} style={styles.portrait} />}
      <Heading overline="From the Principal" title={block.name || 'A word of welcome'} brand={brand} />
      {!!block.message && <Text style={styles.quote}>{block.message}</Text>}
      {!!block.designation && <View style={styles.signature}><View style={[styles.signatureRule, { backgroundColor: brand.primary }]} /><Text style={styles.signatureText}>{block.designation}</Text></View>}</View>
    case 'results': return <View style={[styles.section, { backgroundColor: brand.deep }]}><Heading overline="Academic excellence" title={block.academicYear ? 'Results · ' + block.academicYear : 'Previous academic year'} brand={brand} inverse />
      <View style={styles.figures}>{!!block.passPercentage && <View><Text style={[styles.figure, { borderBottomColor: brand.accent }]}>{block.passPercentage}%</Text><Text style={[styles.figureLabel, { color: brand.muted }]}>Pass percentage</Text></View>}
        {!!block.distinctions && <View><Text style={[styles.figure, { borderBottomColor: brand.accent }]}>{figure(block.distinctions)}</Text><Text style={[styles.figureLabel, { color: brand.muted }]}>Distinctions</Text></View>}</View>
      {block.ranks.length > 0 && <View style={styles.ranks}>{block.ranks.map((rank, i) => <View key={i} style={[styles.rank, i > 0 && styles.rankDivider]}>
        <View style={[styles.rankBadge, { backgroundColor: brand.accent }]}><Text style={[styles.rankBadgeText, { color: brand.onAccent }]}>{rank.rank || i + 1}</Text></View>
        <View style={styles.flex}><Text style={styles.rankName}>{rank.name}</Text>{!!rank.detail && <Text style={[styles.rankDetail, { color: brand.muted }]}>{rank.detail}</Text>}</View></View>)}</View>}</View>
    case 'faculty': return <View style={styles.sectionFlush}><View style={styles.inset}><Heading overline="Our people" title="Featured faculty" brand={brand} /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.people}>{block.items.map((person, i) => <View key={i} style={styles.person}>
        <SchoolImage id={person.photoId} position={person.photoPosition} style={[styles.personTile, { backgroundColor: brand.primary }]} fallback={<Text style={styles.monogram}>{initials(person.name)}</Text>} />
        <View style={[styles.personName, { backgroundColor: withAlpha(brand.deep, 0.82) }]}><Text style={styles.personNameText} numberOfLines={1}>{person.name}</Text>
          {!!(person.designation || person.department) && <Text style={styles.personRole} numberOfLines={1}>{[person.designation, person.department].filter(Boolean).join(' · ')}</Text>}</View>
        {!!person.description && <Text style={styles.personAbout} numberOfLines={3}>{person.description}</Text>}</View>)}</ScrollView></View>
    case 'achievements': return <View style={[styles.section, { backgroundColor: brand.tint }]}><Heading overline="Achievements" title="Moments we are proud of" brand={brand} />
      {block.items.map((item, i) => <View key={i} style={[styles.win, i > 0 && styles.winRow]}>{!!item.imageId && <SchoolImage id={item.imageId} style={i === 0 ? styles.winLead : styles.winThumb} />}
        <View style={[styles.winText, i > 0 && styles.flex]}>{!!item.category && <View style={[styles.chip, { backgroundColor: brand.accent }]}><Text style={[styles.chipText, { color: brand.onAccent }]}>{item.category}</Text></View>}
          <Text style={styles.winTitle}>{item.title}</Text>{!!item.description && <Text style={styles.winAbout}>{item.description}</Text>}</View></View>)}</View>
    case 'events': return <View style={styles.section}><Heading overline="School calendar" title="Upcoming events" brand={brand} />
      {block.items.map((event, i) => { const start = dayParts(event.startsOn); return <View key={i} style={[styles.event, i > 0 && styles.listDivider]}>
        <View style={[styles.date, { backgroundColor: brand.primary, borderBottomColor: brand.accent }]}><Text style={styles.dateDay}>{start?.day}</Text><Text style={styles.dateMonth}>{start?.month}</Text></View>
        <View style={styles.flex}><Text style={styles.listTitle}>{event.title}</Text><Text style={[styles.listMeta, { color: brand.primary }]}>{dayRange(event.startsOn, event.endsOn)}</Text>{!!event.description && <Text style={styles.listAbout}>{event.description}</Text>}</View></View> })}</View>
    case 'announcements': return <View style={[styles.section, { backgroundColor: brand.tint }]}><Heading overline="Notices" title="Announcements" brand={brand} />
      {block.items.map((notice, i) => <View key={i} style={[styles.notice, i > 0 && styles.listDivider]}>{!!dayParts(notice.createdAt) && <Text style={[styles.listMeta, { color: brand.primary }]}>{dayParts(notice.createdAt)!.label}</Text>}
        <Text style={styles.listTitle}>{notice.title}</Text>{!!notice.message && <Text style={styles.listAbout} numberOfLines={4}>{notice.message}</Text>}</View>)}</View>
    case 'gallery': return <View style={styles.section}><Heading overline="School gallery" title={'Life at ' + schoolName} brand={brand} />
      <View style={styles.gallery}>{block.items.map((photo, i) => <View key={i} style={i === 0 || (block.items.length % 2 === 0 && i === block.items.length - 1) ? styles.photoWide : styles.photo}>
        <SchoolImage id={photo.imageId} label={photo.caption || 'School photograph ' + (i + 1)} style={styles.photoImage} fallback={<Ionicons name="image-outline" size={24} color={color.textFaint} />} />
        {!!photo.caption && <View style={styles.caption}><Text style={styles.captionText} numberOfLines={1}>{photo.caption}</Text></View>}</View>)}</View></View>
  }
}

export function SchoolHomeScreen({ home, firstName, onEnter }: { home: SchoolHome, firstName?: string, onEnter: () => void }) {
  const brand = useBrand(), insets = useSafeAreaInsets(), { height } = useWindowDimensions()
  const hero = heroOf(home), blocks = blocksOf(home), name = home.schoolName || 'Your school'
  const lift = blocks[0]?.key === 'statistics'
  return <View style={styles.page}><StatusBar style="light" />
    <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 96 }} showsVerticalScrollIndicator={false}>
      <View style={[styles.hero, { minHeight: Math.max(420, Math.min(620, height * 0.74)), backgroundColor: brand.deep, paddingTop: insets.top + space.xl, paddingBottom: lift ? space.xxxl + space.xl : space.xxl }]}>
        {hero.bannerId ? <><SchoolImage id={hero.bannerId} position={hero.bannerPosition} style={StyleSheet.absoluteFill} /><View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(brand.deep, 0.34) }]} />
          <View style={[styles.heroShade, { backgroundColor: withAlpha(brand.deep, 0.66) }]} /><View style={[styles.statusShade, { height: insets.top + 28 }]} /></>
          : <View style={styles.heroArt}><View style={[styles.ring, styles.ringOuter]} /><View style={[styles.ring, { borderColor: brand.accent, backgroundColor: withAlpha(brand.primary, 0.55) }]}>{!hero.logoId && <Text style={styles.emblem}>{initials(name, 3)}</Text>}</View></View>}
        <View style={styles.heroContent}>
          <View style={styles.identity}>{!!hero.logoId && <SchoolImage id={hero.logoId} label={name + ' logo'} style={styles.logo} />}
            {!!firstName && <View style={styles.greeting}><Text style={styles.greetingText}>{greeting(new Date().getHours())}, {firstName}</Text></View>}</View>
          <Text style={styles.welcome}>WELCOME TO</Text>
          <Text accessibilityRole="header" style={styles.school} adjustsFontSizeToFit numberOfLines={3}>{name}</Text>
          {!!hero.tagline && <Text style={styles.tagline}>{hero.tagline}</Text>}
          {!!hero.motto && <View style={styles.mottoRow}><View style={[styles.mottoRule, { backgroundColor: brand.accent }]} /><Text style={styles.motto}>{hero.motto}</Text></View>}
        </View>
      </View>
      {blocks.map((block, i) => <View key={block.key} style={i === 0 && lift ? styles.lift : undefined}><Section block={block} brand={brand} schoolName={name} /></View>)}
      <View style={[styles.foot, { backgroundColor: brand.deep }]}><Text style={styles.footName}>{name}</Text>{!!(hero.motto || hero.tagline) && <Text style={[styles.footMotto, { color: brand.muted }]}>{hero.motto || hero.tagline}</Text>}
        <Text style={[styles.powered, { color: brand.muted }]}>Powered by EduOS</Text></View>
    </ScrollView>
    <View style={[styles.enter, { paddingBottom: insets.bottom + space.md }]}><Button label="Enter EduOS" icon="arrow-forward" onPress={onEnter} tint={brand.primary} onTint="#ffffff" /></View>
  </View>
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, page: { flex: 1, backgroundColor: '#ffffff' },
  hero: { justifyContent: 'flex-end', overflow: 'hidden' }, heroShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '58%' },
  heroArt: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  ring: { position: 'absolute', top: 70, right: -40, width: 210, height: 210, borderRadius: 105, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  ringOuter: { top: 30, right: -90, width: 320, height: 320, borderRadius: 160, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  emblem: { color: 'rgba(255,255,255,0.92)', fontSize: 58, fontWeight: '700', letterSpacing: -2 },
  heroContent: { paddingHorizontal: space.xl, gap: space.sm },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm }, statusShade: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: 'rgba(0,0,0,0.22)' },
  logo: { width: 68, height: 68, borderRadius: 18, borderWidth: 3, borderColor: '#ffffff', backgroundColor: '#ffffff' },
  greeting: { alignSelf: 'flex-start', paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.2)' }, greetingText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
  welcome: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '600', letterSpacing: 3, marginTop: space.sm },
  school: { color: '#ffffff', fontSize: 40, lineHeight: 43, fontWeight: '700', letterSpacing: -1.2 },
  tagline: { color: '#ffffff', fontSize: 18, lineHeight: 25, marginTop: space.xs },
  mottoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm }, mottoRule: { width: 36, height: 3, borderRadius: 2 }, motto: { flex: 1, color: '#ffffff', fontSize: 17, fontStyle: 'italic', fontFamily: SERIF },
  lift: { marginTop: -56 }, glanceWrap: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  glance: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#ffffff', borderRadius: radius.xl, paddingVertical: space.md, ...elevation.raised },
  glanceItem: { width: '50%', paddingHorizontal: space.xl, paddingVertical: space.md }, glanceValue: { fontSize: 36, fontWeight: '700', letterSpacing: -1.2 },
  glanceLabel: { marginTop: 4, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: color.textMuted },
  section: { paddingHorizontal: space.xl, paddingVertical: space.xxxl }, sectionFlush: { paddingVertical: space.xxxl }, inset: { paddingHorizontal: space.xl },
  heading: { marginBottom: space.xl }, overlineRow: { flexDirection: 'row', alignItems: 'center', gap: space.md }, rule: { width: 26, height: 3, borderRadius: 2 },
  overline: { fontSize: 11, fontWeight: '700', letterSpacing: 2 }, title: { marginTop: space.md, fontSize: 28, lineHeight: 32, fontWeight: '700', letterSpacing: -0.7, color: color.text },
  purpose: { borderLeftWidth: 3, paddingLeft: space.lg, marginBottom: space.xl }, purposeLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' }, purposeText: { marginTop: space.sm, fontSize: 18, lineHeight: 27, color: color.text },
  portrait: { width: '100%', aspectRatio: 4 / 5, borderRadius: radius.xl, marginBottom: space.xl },
  quote: { fontSize: 19, lineHeight: 30, fontStyle: 'italic', fontFamily: SERIF, color: color.text },
  signature: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xl }, signatureRule: { width: 40, height: 3, borderRadius: 2 }, signatureText: { fontSize: 14, color: color.textMuted },
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xxl }, figure: { color: '#ffffff', fontSize: 60, lineHeight: 64, fontWeight: '700', letterSpacing: -2.5, borderBottomWidth: 4, paddingBottom: space.sm, alignSelf: 'flex-start' },
  figureLabel: { marginTop: space.md, fontSize: 12, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  ranks: { marginTop: space.xxl, borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', paddingHorizontal: space.lg },
  rank: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: space.lg }, rankDivider: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.16)' },
  rankBadge: { minWidth: 44, height: 44, borderRadius: 22, paddingHorizontal: space.sm, alignItems: 'center', justifyContent: 'center' }, rankBadgeText: { fontSize: 13, fontWeight: '700' },
  rankName: { color: '#ffffff', fontSize: 16, fontWeight: '600' }, rankDetail: { marginTop: 2, fontSize: 13 },
  people: { paddingHorizontal: space.xl, gap: space.lg }, person: { width: 220 }, personTile: { width: 220, height: 290, borderRadius: radius.xl },
  monogram: { color: 'rgba(255,255,255,0.28)', fontSize: 84, fontWeight: '700' },
  personName: { position: 'absolute', left: 0, right: 0, top: 290 - 70, height: 70, justifyContent: 'center', paddingHorizontal: space.lg, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl },
  personNameText: { color: '#ffffff', fontSize: 17, fontWeight: '700' }, personRole: { color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 2 }, personAbout: { marginTop: space.md, fontSize: 14, lineHeight: 20, color: color.textMuted },
  win: { backgroundColor: '#ffffff', borderRadius: radius.xl, overflow: 'hidden', marginBottom: space.lg, ...elevation.card }, winLead: { width: '100%', aspectRatio: 4 / 3 }, winRow: { flexDirection: 'row', alignItems: 'stretch' }, winThumb: { width: 112, minHeight: 112 },
  winText: { padding: space.lg, gap: space.sm }, chip: { alignSelf: 'flex-start', paddingHorizontal: space.md, paddingVertical: 5, borderRadius: radius.pill }, chipText: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  winTitle: { fontSize: 19, lineHeight: 24, fontWeight: '700', letterSpacing: -0.3, color: color.text }, winAbout: { fontSize: 14, lineHeight: 21, color: color.textMuted },
  event: { flexDirection: 'row', gap: space.lg, paddingVertical: space.lg }, listDivider: { borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)' },
  date: { width: 62, height: 68, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 4 }, dateDay: { color: '#ffffff', fontSize: 25, fontWeight: '700', lineHeight: 28 }, dateMonth: { color: '#ffffff', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  listTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: color.text }, listMeta: { fontSize: 13, fontWeight: '600', marginTop: 2 }, listAbout: { marginTop: space.xs, fontSize: 14, lineHeight: 21, color: color.textMuted },
  notice: { paddingVertical: space.lg, gap: 2 },
  gallery: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.md }, photoWide: { width: '100%', aspectRatio: 16 / 10 }, photo: { width: '48.4%', aspectRatio: 1 }, photoImage: { flex: 1, borderRadius: radius.lg },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.md, paddingVertical: space.sm, backgroundColor: 'rgba(0,0,0,0.5)', borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg }, captionText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
  foot: { paddingHorizontal: space.xl, paddingVertical: space.xxl, gap: space.xs }, footName: { color: '#ffffff', fontSize: 22, fontWeight: '700', letterSpacing: -0.4 }, footMotto: { fontSize: 15, fontStyle: 'italic', fontFamily: SERIF }, powered: { marginTop: space.lg, fontSize: 12, letterSpacing: 0.4 },
  enter: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingTop: space.md, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: color.border, ...elevation.raised },
})
