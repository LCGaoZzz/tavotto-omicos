import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { diagnosticText, figureFailure, mountFigureError, type FigureErrorContext, type FigureErrorElement } from '@/lib/figureError'
/** Original diagnostic lives in the caller and this explicit details view, never in public copy. */
export function FigureError({ error, context='operation', traceback }: {error:unknown;context?:FigureErrorContext;traceback?:string}) {
  const {i18n}=useTranslation()
  const node=useRef<HTMLSpanElement>(null), element=useRef<FigureErrorElement|null>(null)
  useLayoutEffect(()=>{if(node.current)element.current=mountFigureError(node.current);return()=>{element.current?.remove();element.current=null}},[])
  useLayoutEffect(()=>{
    const diagnostic=traceback ? { error: diagnosticText(error), traceback } : error
    element.current?.setFailure(figureFailure(diagnostic,context),i18n.language)
  },[error,traceback,context,i18n.language])
  return <span ref={node} style={{display:'block',minWidth:0}} />
}
