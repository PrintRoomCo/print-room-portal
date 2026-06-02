export default function Loading() {
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-[1320px] px-4 pb-16 pt-[100px] md:px-6 md:pt-[120px]">
        <div className="mb-10 h-16 w-64 animate-pulse rounded-2xl bg-gray-200" />
        <div className="mb-6 h-64 w-full animate-pulse rounded-2xl bg-gray-100" />
        <div className="h-64 w-full animate-pulse rounded-2xl bg-gray-100" />
      </div>
    </div>
  )
}
