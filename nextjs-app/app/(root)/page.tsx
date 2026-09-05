import { redirect } from 'next/navigation';

export default function Home() {
  const org = process.env.DEFAULT_ORG_SLUG;
  redirect(org ? `/en/${org}/jobs` : '/en/jobs');
}
