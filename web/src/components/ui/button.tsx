import type {ButtonHTMLAttributes} from 'react';
import {cva,type VariantProps} from 'class-variance-authority';
import {cn} from '../../lib/utils';
const styles=cva('button',{variants:{variant:{default:'button-primary',secondary:'button-secondary',ghost:'button-ghost',danger:'button-danger'},size:{default:'',icon:'button-icon',small:'button-small'}},defaultVariants:{variant:'default',size:'default'}});
export function Button({className,variant,size,...props}:ButtonHTMLAttributes<HTMLButtonElement>&VariantProps<typeof styles>){return <button className={cn(styles({variant,size}),className)} {...props}/>;}
