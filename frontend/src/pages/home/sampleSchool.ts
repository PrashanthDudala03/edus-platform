import client from '../../api/client'
import type { Draft } from './schoolHome'

/** Sample photos are uploaded into this school's existing protected image store. */
export async function sampleSchool(draft: Draft, teachers: { id: string, label: string }[]): Promise<Draft> {
  const upload = async (name: string) => {
    const response = await fetch('/sample-school/' + name)
    if (!response.ok) throw new Error('Could not load sample photograph.')
    const form = new FormData(); form.append('file', new File([await response.blob()], name, { type: name.endsWith('.png') ? 'image/png' : 'image/jpeg' }))
    return String((await client.post('/suite/home/images', form)).data.data.id)
  }
  const bannerId = await upload('campus.jpg'), logoId = await upload('logo.png'), principalId = await upload('principal.jpg'), facultyId = await upload('faculty.jpg'), classroomId = await upload('classroom.jpg')
  return { ...draft,
    hero: { ...draft.hero, bannerId, logoId, bannerPosition: 'center', tagline: draft.hero.tagline || 'A place to learn, discover and grow' },
    identity: { motto: 'Learn. Grow. Lead.', vision: 'A welcoming school where every learner can thrive.', mission: 'Learning through curiosity, kindness and shared discovery.' },
    principal: { ...draft.principal, name: draft.principal.name || 'Sample principal', designation: 'Principal', message: 'Welcome to our school community. This sample shows how your photographs and school colours come together. Replace the sample content with your own before publishing.', photoId: principalId, photoPosition: 'center' },
    faculty: { items: teachers.slice(0, 2).map((teacher, i) => ({ teacherId: teacher.id, designation: 'Featured teacher', description: 'Sample portrait — replace with your own staff photograph.', photoId: i ? facultyId : principalId, photoPosition: 'center', visible: true })) },
    achievements: { items: [{ title: 'Sample learning showcase', description: 'A sample highlight: replace with an achievement from your school.', category: 'Academic', imageId: classroomId }] },
    gallery: { items: [{ imageId: bannerId, caption: 'Sample campus photograph' }, { imageId: classroomId, caption: 'Sample learning space' }] },
  }
}
